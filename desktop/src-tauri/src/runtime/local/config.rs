use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

use base64::{engine::general_purpose::STANDARD, Engine};
use keyring::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};
use tokio::fs;

use super::ports;
use super::{layout::LocalRuntimeLayout, postgresql, LocalRuntimeError};

const KEYRING_SERVICE: &str = "com.mewisme.discloud.local-runtime";
const KEYRING_ENCRYPTION_KEY: &str = "backend.encryption-master-key";
const KEYRING_DISCORD_TOKENS_LEGACY: &str = "backend.discord-bot-tokens";
const KEYRING_DISCORD_TOKEN_COUNT: &str = "backend.discord-bot-token-count";
const KEYRING_DISCORD_TOKEN_PREFIX: &str = "backend.discord-bot-token";
const ENV_ENCRYPTION_KEY: &str = "DISCLOUD_ENCRYPTION_MASTER_KEY_BASE64";
const ENV_DISCORD_GUILD_ID: &str = "DISCLOUD_DISCORD_GUILD_ID";
const ENV_DISCORD_CHANNEL_ID: &str = "DISCLOUD_DISCORD_CHANNEL_ID";
const ENV_DISCORD_BOT_TOKENS: &str = "DISCLOUD_DISCORD_BOT_TOKENS";
const ENV_LOCAL_WEB_ENABLED: &str = "DISCLOUD_LOCAL_WEB_ENABLED";
const DEFAULT_CONFIG: &str = "# DisCloud local server settings\n# Secrets are stored in the OS keyring when configured through Desktop.\nDISCLOUD_DISCORD_GUILD_ID=\nDISCLOUD_DISCORD_CHANNEL_ID=\nDISCLOUD_LOG_LEVEL=info\nDISCLOUD_LOCAL_WEB_ENABLED=false\n\n# Manual/dev fallback only. Prefer the Desktop settings UI once available.\n# DISCLOUD_DISCORD_BOT_TOKENS=\n";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalServerSettings {
    guild_id: String,
    channel_id: String,
    bot_tokens_configured: bool,
    bot_token_count: usize,
    encryption_key_configured: bool,
    database_password_configured: bool,
    data_directory: String,
    default_data_directory: String,
    using_custom_data_directory: bool,
    data_directory_locked: bool,
    backend_preferred_port: u16,
    postgresql_preferred_port: u16,
    web_preferred_port: u16,
    web_enabled: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalServerSettingsInput {
    guild_id: String,
    channel_id: String,
    bot_tokens: Option<String>,
    data_directory: Option<String>,
    web_enabled: Option<bool>,
}

pub(super) async fn ensure_config_file(
    layout: &LocalRuntimeLayout,
) -> Result<(), LocalRuntimeError> {
    if fs::try_exists(&layout.config_path).await.map_err(|error| {
        LocalRuntimeError::io("Could not inspect the local server config", error)
    })? {
        return Ok(());
    }
    fs::write(&layout.config_path, DEFAULT_CONFIG)
        .await
        .map_err(|error| LocalRuntimeError::io("Could not create the local server config", error))
}

pub(super) async fn load_settings<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<LocalServerSettings, LocalRuntimeError> {
    let layout = LocalRuntimeLayout::resolve(app)?;
    layout.prepare().await?;
    ensure_config_file(&layout).await?;
    let env = parse_env_file(&layout.config_path).await?;
    let keyring_tokens = discord_bot_tokens()?;
    let env_tokens =
        nonempty(&env, ENV_DISCORD_BOT_TOKENS).map(|value| normalize_bot_token_list(&value));
    let bot_token_count = keyring_tokens
        .as_ref()
        .map_or_else(|| env_tokens.as_ref().map_or(0, Vec::len), Vec::len);
    let default_root = LocalRuntimeLayout::default_root(app)?;
    let data_directory_locked = layout.database_initialized().await?;
    Ok(LocalServerSettings {
        guild_id: nonempty(&env, ENV_DISCORD_GUILD_ID).unwrap_or_default(),
        channel_id: nonempty(&env, ENV_DISCORD_CHANNEL_ID).unwrap_or_default(),
        bot_tokens_configured: bot_token_count > 0,
        bot_token_count,
        encryption_key_configured: keyring_value(KEYRING_ENCRYPTION_KEY)?.is_some()
            || nonempty(&env, ENV_ENCRYPTION_KEY).is_some(),
        database_password_configured: postgresql::password_configured()?,
        data_directory: path_string(&layout.root_dir),
        default_data_directory: path_string(&default_root),
        using_custom_data_directory: layout.root_dir != default_root,
        data_directory_locked,
        backend_preferred_port: ports::BACKEND_PREFERRED_PORT,
        postgresql_preferred_port: ports::POSTGRESQL_PREFERRED_PORT,
        web_preferred_port: ports::WEB_PREFERRED_PORT,
        web_enabled: bool_value(&env, ENV_LOCAL_WEB_ENABLED)?.unwrap_or(false),
    })
}

pub(super) async fn save_settings<R: Runtime>(
    app: &AppHandle<R>,
    input: LocalServerSettingsInput,
) -> Result<LocalServerSettings, LocalRuntimeError> {
    let guild_id = validate_snowflake("Discord guild ID", &input.guild_id)?;
    let channel_id = validate_snowflake("Discord channel ID", &input.channel_id)?;
    let current_layout = LocalRuntimeLayout::resolve(app)?;
    current_layout.prepare().await?;
    ensure_config_file(&current_layout).await?;
    let mut env = parse_env_file(&current_layout.config_path).await?;
    let requested_root = input
        .data_directory
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| current_layout.root_dir.clone());
    if !requested_root.is_absolute() {
        return Err(LocalRuntimeError::configuration(
            "The local runtime data directory must be an absolute path.",
        ));
    }
    if requested_root != current_layout.root_dir && current_layout.database_initialized().await? {
        return Err(LocalRuntimeError::invalid_state(
            "The local data directory cannot be changed after PostgreSQL has been initialized.",
        ));
    }

    let submitted_tokens = normalize_bot_token_list(input.bot_tokens.as_deref().unwrap_or(""));
    if !submitted_tokens.is_empty() {
        store_discord_bot_tokens(&submitted_tokens)?;
    } else if discord_bot_tokens()?.is_none() {
        let existing_tokens = nonempty(&env, ENV_DISCORD_BOT_TOKENS)
            .map(|value| normalize_bot_token_list(&value))
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                LocalRuntimeError::configuration(
                    "At least one Discord bot token is required for the local server.",
                )
            })?;
        store_discord_bot_tokens(&existing_tokens)?;
    }
    let _ = encryption_key(&env)?;
    let _ = postgresql::ensure_password()?;

    env.insert(ENV_DISCORD_GUILD_ID.into(), guild_id);
    env.insert(ENV_DISCORD_CHANNEL_ID.into(), channel_id);
    env.remove(ENV_DISCORD_BOT_TOKENS);
    env.remove(ENV_ENCRYPTION_KEY);
    env.entry("DISCLOUD_LOG_LEVEL".into())
        .or_insert_with(|| "info".into());
    let web_enabled = input
        .web_enabled
        .unwrap_or(bool_value(&env, ENV_LOCAL_WEB_ENABLED)?.unwrap_or(false));
    env.insert(ENV_LOCAL_WEB_ENABLED.into(), web_enabled.to_string());

    let target_layout = LocalRuntimeLayout::for_root(requested_root.clone())?;
    target_layout.prepare().await?;
    write_env_file(&target_layout.config_path, &env).await?;
    LocalRuntimeLayout::set_root(app, &requested_root).await?;
    load_settings(app).await
}

pub(super) async fn web_enabled(layout: &LocalRuntimeLayout) -> Result<bool, LocalRuntimeError> {
    ensure_config_file(layout).await?;
    let env = parse_env_file(&layout.config_path).await?;
    Ok(bool_value(&env, ENV_LOCAL_WEB_ENABLED)?.unwrap_or(false))
}

pub(super) async fn backend_environment(
    layout: &LocalRuntimeLayout,
    postgresql_port: u16,
    backend_port: u16,
) -> Result<BTreeMap<String, String>, LocalRuntimeError> {
    ensure_config_file(layout).await?;
    let mut env = parse_env_file(&layout.config_path).await?;
    require_nonempty(&env, ENV_DISCORD_GUILD_ID)?;
    require_nonempty(&env, ENV_DISCORD_CHANNEL_ID)?;

    let discord_tokens = discord_bot_tokens()?
        .or_else(|| nonempty(&env, ENV_DISCORD_BOT_TOKENS).map(|value| normalize_bot_token_list(&value)))
        .filter(|tokens| !tokens.is_empty())
        .ok_or_else(|| {
        LocalRuntimeError::configuration("Discord bot tokens are required for the local server. Configure them in Desktop settings or DISCLOUD_DISCORD_BOT_TOKENS in local-server.env.")
    })?;
    let encryption_key = encryption_key(&env)?;
    let database_password = postgresql::password()?;
    let base_url = format!("http://127.0.0.1:{backend_port}");

    env.insert(
        "DISCLOUD_HTTP_LISTEN_ADDRESS".into(),
        format!("127.0.0.1:{backend_port}"),
    );
    env.insert("DISCLOUD_PUBLIC_BASE_URL".into(), base_url);
    env.insert("DISCLOUD_DATABASE_DSN".into(), format!("postgres://discloud:{database_password}@127.0.0.1:{postgresql_port}/discloud?sslmode=disable"));
    env.insert("DISCLOUD_AUTH_COOKIE_SECURE".into(), "false".into());
    env.insert(ENV_ENCRYPTION_KEY.into(), encryption_key);
    env.insert(ENV_DISCORD_BOT_TOKENS.into(), discord_tokens.join(","));
    env.insert(
        "DISCLOUD_MANAGED_SHUTDOWN_FILE".into(),
        layout.backend_shutdown_path.to_string_lossy().into_owned(),
    );
    Ok(env)
}

pub(super) fn store_discord_bot_tokens(tokens: &[String]) -> Result<(), LocalRuntimeError> {
    if tokens.is_empty() {
        return Err(LocalRuntimeError::configuration(
            "Discord bot tokens cannot be empty.",
        ));
    }
    let previous_count = discord_bot_token_count()?.unwrap_or(0);
    for (index, token) in tokens.iter().enumerate() {
        keyring_entry(&discord_bot_token_key(index))?
            .set_password(token)
            .map_err(|error| {
                LocalRuntimeError::credentials(format!(
                    "Could not save Discord bot token {} to the OS keyring: {error}",
                    index + 1
                ))
            })?;
    }
    keyring_entry(KEYRING_DISCORD_TOKEN_COUNT)?
        .set_password(&tokens.len().to_string())
        .map_err(|error| {
            LocalRuntimeError::credentials(format!(
                "Could not save the Discord bot token count to the OS keyring: {error}"
            ))
        })?;
    for index in tokens.len()..previous_count {
        delete_keyring_value(&discord_bot_token_key(index))?;
    }
    delete_keyring_value(KEYRING_DISCORD_TOKENS_LEGACY)
}

async fn write_env_file(
    path: &Path,
    env: &BTreeMap<String, String>,
) -> Result<(), LocalRuntimeError> {
    let mut content = String::from(
        "# DisCloud local server settings\n# Secrets are stored in the OS keyring and are never written here.\n",
    );
    for (key, value) in env {
        content.push_str(key);
        content.push('=');
        content.push_str(value);
        content.push('\n');
    }
    let temporary = path.with_extension("env.tmp");
    fs::write(&temporary, content)
        .await
        .map_err(|error| LocalRuntimeError::io("Could not write the local server config", error))?;
    if fs::try_exists(path).await.map_err(|error| {
        LocalRuntimeError::io("Could not inspect the local server config", error)
    })? {
        fs::remove_file(path).await.map_err(|error| {
            LocalRuntimeError::io("Could not replace the local server config", error)
        })?;
    }
    fs::rename(&temporary, path)
        .await
        .map_err(|error| LocalRuntimeError::io("Could not install the local server config", error))
}

async fn parse_env_file(path: &Path) -> Result<BTreeMap<String, String>, LocalRuntimeError> {
    let content = fs::read_to_string(path)
        .await
        .map_err(|error| LocalRuntimeError::io("Could not read the local server config", error))?;
    parse_env(&content)
}

fn parse_env(content: &str) -> Result<BTreeMap<String, String>, LocalRuntimeError> {
    let mut values = BTreeMap::new();
    for (index, raw_line) in content.lines().enumerate() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let (key, value) = line.split_once('=').ok_or_else(|| {
            LocalRuntimeError::configuration(format!(
                "Invalid local-server.env line {}: expected KEY=VALUE.",
                index + 1
            ))
        })?;
        let key = key.trim();
        if key.is_empty()
            || !key
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
        {
            return Err(LocalRuntimeError::configuration(format!(
                "Invalid local-server.env key on line {}.",
                index + 1
            )));
        }
        values.insert(key.to_string(), unquote(value.trim()).to_string());
    }
    Ok(values)
}

fn unquote(value: &str) -> &str {
    if value.len() >= 2 {
        let bytes = value.as_bytes();
        if (bytes[0] == b'"' && bytes[value.len() - 1] == b'"')
            || (bytes[0] == b'\'' && bytes[value.len() - 1] == b'\'')
        {
            return &value[1..value.len() - 1];
        }
    }
    value
}

fn require_nonempty(
    values: &BTreeMap<String, String>,
    key: &str,
) -> Result<String, LocalRuntimeError> {
    nonempty(values, key).ok_or_else(|| {
        LocalRuntimeError::configuration(format!("{key} is required for the local server."))
    })
}

fn nonempty(values: &BTreeMap<String, String>, key: &str) -> Option<String> {
    values
        .get(key)
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn bool_value(
    values: &BTreeMap<String, String>,
    key: &str,
) -> Result<Option<bool>, LocalRuntimeError> {
    let Some(value) = nonempty(values, key) else {
        return Ok(None);
    };
    match value.to_ascii_lowercase().as_str() {
        "true" | "1" | "yes" | "on" => Ok(Some(true)),
        "false" | "0" | "no" | "off" => Ok(Some(false)),
        _ => Err(LocalRuntimeError::configuration(format!(
            "{key} must be true or false."
        ))),
    }
}

fn validate_snowflake(label: &str, value: &str) -> Result<String, LocalRuntimeError> {
    let value = value.trim();
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(LocalRuntimeError::configuration(format!(
            "{label} must contain only digits."
        )));
    }
    Ok(value.to_string())
}

fn normalize_bot_token_list(value: &str) -> Vec<String> {
    value
        .split([',', '\n', '\r'])
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .map(str::to_owned)
        .collect()
}

fn discord_bot_tokens() -> Result<Option<Vec<String>>, LocalRuntimeError> {
    if let Some(count) = discord_bot_token_count()? {
        if count == 0 {
            return Ok(None);
        }
        let mut tokens = Vec::with_capacity(count);
        for index in 0..count {
            let token = keyring_value(&discord_bot_token_key(index))?.ok_or_else(|| {
                LocalRuntimeError::credentials(format!(
                    "Discord bot token {} is missing from the OS keyring.",
                    index + 1
                ))
            })?;
            tokens.push(token);
        }
        return Ok(Some(tokens));
    }

    let Some(legacy) = keyring_value(KEYRING_DISCORD_TOKENS_LEGACY)? else {
        return Ok(None);
    };
    let tokens = normalize_bot_token_list(&legacy);
    if tokens.is_empty() {
        delete_keyring_value(KEYRING_DISCORD_TOKENS_LEGACY)?;
        return Ok(None);
    }
    store_discord_bot_tokens(&tokens)?;
    Ok(Some(tokens))
}

fn discord_bot_token_count() -> Result<Option<usize>, LocalRuntimeError> {
    let Some(value) = keyring_value(KEYRING_DISCORD_TOKEN_COUNT)? else {
        return Ok(None);
    };
    value.parse::<usize>().map(Some).map_err(|error| {
        LocalRuntimeError::credentials(format!(
            "The Discord bot token count in the OS keyring is invalid: {error}"
        ))
    })
}

fn discord_bot_token_key(index: usize) -> String {
    format!("{KEYRING_DISCORD_TOKEN_PREFIX}.{index}")
}

fn delete_keyring_value(username: &str) -> Result<(), LocalRuntimeError> {
    match keyring_entry(username)?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => Err(LocalRuntimeError::credentials(format!(
            "Could not delete a local runtime secret from the OS keyring: {error}"
        ))),
    }
}

fn encryption_key(env: &BTreeMap<String, String>) -> Result<String, LocalRuntimeError> {
    if let Some(value) = keyring_value(KEYRING_ENCRYPTION_KEY)? {
        validate_encryption_key(&value)?;
        return Ok(value);
    }
    if let Some(value) = nonempty(env, ENV_ENCRYPTION_KEY) {
        validate_encryption_key(&value)?;
        keyring_entry(KEYRING_ENCRYPTION_KEY)?
            .set_password(&value)
            .map_err(|error| {
                LocalRuntimeError::credentials(format!(
                    "Could not save the backend encryption key to the OS keyring: {error}"
                ))
            })?;
        return Ok(value);
    }
    let bytes: [u8; 32] = rand::random();
    let value = STANDARD.encode(bytes);
    keyring_entry(KEYRING_ENCRYPTION_KEY)?
        .set_password(&value)
        .map_err(|error| {
            LocalRuntimeError::credentials(format!(
                "Could not save the backend encryption key to the OS keyring: {error}"
            ))
        })?;
    Ok(value)
}

fn validate_encryption_key(value: &str) -> Result<(), LocalRuntimeError> {
    let decoded = STANDARD.decode(value.trim()).map_err(|_| {
        LocalRuntimeError::configuration(
            "DISCLOUD_ENCRYPTION_MASTER_KEY_BASE64 must be valid base64.",
        )
    })?;
    if decoded.len() != 32 {
        return Err(LocalRuntimeError::configuration(
            "DISCLOUD_ENCRYPTION_MASTER_KEY_BASE64 must decode to exactly 32 bytes.",
        ));
    }
    Ok(())
}

fn keyring_value(username: &str) -> Result<Option<String>, LocalRuntimeError> {
    match keyring_entry(username)?.get_password() {
        Ok(value) if !value.trim().is_empty() => Ok(Some(value)),
        Ok(_) | Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(LocalRuntimeError::credentials(format!(
            "Could not read a local runtime secret from the OS keyring: {error}"
        ))),
    }
}

fn keyring_entry(username: &str) -> Result<Entry, LocalRuntimeError> {
    Entry::new(KEYRING_SERVICE, username).map_err(|error| {
        LocalRuntimeError::credentials(format!(
            "Could not open the OS keyring for the local runtime: {error}"
        ))
    })
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::{
        discord_bot_token_key, normalize_bot_token_list, parse_env, validate_encryption_key,
        validate_snowflake,
    };

    #[test]
    fn parses_env_values_and_quotes() {
        let env = parse_env("A=one\nB=\"two words\"\n# comment\nC='three'\n").unwrap();
        assert_eq!(env.get("A").map(String::as_str), Some("one"));
        assert_eq!(env.get("B").map(String::as_str), Some("two words"));
        assert_eq!(env.get("C").map(String::as_str), Some("three"));
    }

    #[test]
    fn rejects_invalid_env_line() {
        assert!(parse_env("INVALID").is_err());
    }

    #[test]
    fn validates_32_byte_encryption_key() {
        assert!(validate_encryption_key("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=").is_ok());
        assert!(validate_encryption_key("YQ==").is_err());
    }

    #[test]
    fn normalizes_discord_bot_tokens() {
        assert_eq!(
            normalize_bot_token_list(" one, two\nthree\r\n"),
            ["one", "two", "three"]
        );
    }

    #[test]
    fn keeps_large_token_lists_split_for_keyring_storage() {
        let input = (0..64)
            .map(|index| format!("token-{index}-{}", "x".repeat(64)))
            .collect::<Vec<_>>()
            .join(",");
        assert!(input.encode_utf16().count() > 2560);
        let tokens = normalize_bot_token_list(&input);
        assert_eq!(tokens.len(), 64);
        assert!(tokens
            .iter()
            .all(|token| token.encode_utf16().count() < 2560));
    }

    #[test]
    fn indexes_discord_bot_token_keyring_entries() {
        assert_eq!(discord_bot_token_key(0), "backend.discord-bot-token.0");
        assert_eq!(discord_bot_token_key(42), "backend.discord-bot-token.42");
    }

    #[test]
    fn validates_discord_snowflakes() {
        assert_eq!(validate_snowflake("Guild", " 123456 ").unwrap(), "123456");
        assert!(validate_snowflake("Guild", "123abc").is_err());
    }
}
