use std::{collections::BTreeMap, path::Path};

use base64::{engine::general_purpose::STANDARD, Engine};
use keyring::{Entry, Error as KeyringError};
use tokio::fs;

use super::{layout::LocalRuntimeLayout, postgresql, LocalRuntimeError};

const KEYRING_SERVICE: &str = "com.mewisme.discloud.local-runtime";
const KEYRING_ENCRYPTION_KEY: &str = "backend.encryption-master-key";
const KEYRING_DISCORD_TOKENS: &str = "backend.discord-bot-tokens";
const ENV_ENCRYPTION_KEY: &str = "DISCLOUD_ENCRYPTION_MASTER_KEY_BASE64";
const ENV_DISCORD_GUILD_ID: &str = "DISCLOUD_DISCORD_GUILD_ID";
const ENV_DISCORD_CHANNEL_ID: &str = "DISCLOUD_DISCORD_CHANNEL_ID";
const ENV_DISCORD_BOT_TOKENS: &str = "DISCLOUD_DISCORD_BOT_TOKENS";
const DEFAULT_CONFIG: &str = "# DisCloud local server settings\n# Secrets are stored in the OS keyring when configured through Desktop.\nDISCLOUD_DISCORD_GUILD_ID=\nDISCLOUD_DISCORD_CHANNEL_ID=\nDISCLOUD_LOG_LEVEL=info\n\n# Manual/dev fallback only. Prefer the Desktop settings UI once available.\n# DISCLOUD_DISCORD_BOT_TOKENS=\n";

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

pub(super) async fn backend_environment(
    layout: &LocalRuntimeLayout,
    postgresql_port: u16,
    backend_port: u16,
) -> Result<BTreeMap<String, String>, LocalRuntimeError> {
    ensure_config_file(layout).await?;
    let mut env = parse_env_file(&layout.config_path).await?;
    require_nonempty(&env, ENV_DISCORD_GUILD_ID)?;
    require_nonempty(&env, ENV_DISCORD_CHANNEL_ID)?;

    let discord_tokens =
        keyring_value(KEYRING_DISCORD_TOKENS)?.or_else(|| nonempty(&env, ENV_DISCORD_BOT_TOKENS));
    let discord_tokens = discord_tokens.ok_or_else(|| {
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
    env.insert(ENV_DISCORD_BOT_TOKENS.into(), discord_tokens);
    env.insert(
        "DISCLOUD_MANAGED_SHUTDOWN_FILE".into(),
        layout.backend_shutdown_path.to_string_lossy().into_owned(),
    );
    Ok(env)
}

#[allow(dead_code)]
pub(super) fn store_discord_bot_tokens(tokens: &str) -> Result<(), LocalRuntimeError> {
    if tokens.trim().is_empty() {
        return Err(LocalRuntimeError::configuration(
            "Discord bot tokens cannot be empty.",
        ));
    }
    keyring_entry(KEYRING_DISCORD_TOKENS)?
        .set_password(tokens.trim())
        .map_err(|error| {
            LocalRuntimeError::credentials(format!(
                "Could not save Discord bot tokens to the OS keyring: {error}"
            ))
        })
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

#[cfg(test)]
mod tests {
    use super::{parse_env, validate_encryption_key};

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
}
