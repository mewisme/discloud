use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};
use tokio::fs;

use super::{layout::LocalRuntimeLayout, LocalRuntimeError};

const CURRENT_DATA_SCHEMA_VERSION: u32 = 1;
const MIN_SUPPORTED_DATA_SCHEMA_VERSION: u32 = 1;
const LEGACY_DATA_SCHEMA_VERSION: u32 = 1;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalDataMetadata {
    schema_version: u32,
    last_app_version: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalDataCompatibility {
    schema_version: u32,
    supported_schema_min: u32,
    supported_schema_max: u32,
    compatible: bool,
    last_app_version: Option<String>,
    detail: Option<String>,
}

pub(super) async fn inspect<R: Runtime>(
    app: &AppHandle<R>,
    layout: &LocalRuntimeLayout,
) -> Result<LocalDataCompatibility, LocalRuntimeError> {
    let metadata = read_metadata(layout).await?;
    let (schema_version, last_app_version) = match metadata {
        Some(metadata) => (metadata.schema_version, Some(metadata.last_app_version)),
        None if legacy_data_exists(layout).await? => (LEGACY_DATA_SCHEMA_VERSION, None),
        None => (CURRENT_DATA_SCHEMA_VERSION, None),
    };
    evaluate(
        schema_version,
        last_app_version,
        &app.package_info().version.to_string(),
    )
}

pub(super) async fn ensure_compatible<R: Runtime>(
    app: &AppHandle<R>,
    layout: &LocalRuntimeLayout,
) -> Result<LocalDataCompatibility, LocalRuntimeError> {
    let compatibility = inspect(app, layout).await?;
    if !compatibility.compatible {
        return Err(LocalRuntimeError::incompatible_data(
            compatibility.detail.clone().unwrap_or_else(|| {
                "The local data directory is not compatible with this DisCloud version.".into()
            }),
        ));
    }
    layout.prepare().await?;
    write_metadata(
        layout,
        &LocalDataMetadata {
            schema_version: compatibility.schema_version,
            last_app_version: app.package_info().version.to_string(),
        },
    )
    .await?;
    inspect(app, layout).await
}

fn evaluate(
    schema_version: u32,
    last_app_version: Option<String>,
    current_app_version: &str,
) -> Result<LocalDataCompatibility, LocalRuntimeError> {
    let current_version = semver::Version::parse(current_app_version).map_err(|error| {
        LocalRuntimeError::internal(format!("The current DisCloud version is invalid: {error}"))
    })?;
    let last_version = last_app_version
        .as_deref()
        .map(semver::Version::parse)
        .transpose()
        .map_err(|error| {
            LocalRuntimeError::configuration(format!(
                "The last DisCloud version in local data metadata is invalid: {error}"
            ))
        })?;
    let schema_compatible =
        (MIN_SUPPORTED_DATA_SCHEMA_VERSION..=CURRENT_DATA_SCHEMA_VERSION).contains(&schema_version);
    let downgrade = last_version
        .as_ref()
        .is_some_and(|version| version > &current_version);
    let detail = if schema_version > CURRENT_DATA_SCHEMA_VERSION {
        Some(match last_app_version.as_deref() {
            Some(version) => format!(
                "Local data schema {schema_version} is newer than this DisCloud build supports (up to {CURRENT_DATA_SCHEMA_VERSION}). It was last used by DisCloud {version}. Update DisCloud before using Local mode."
            ),
            None => format!(
                "Local data schema {schema_version} is newer than this DisCloud build supports (up to {CURRENT_DATA_SCHEMA_VERSION}). Update DisCloud before using Local mode."
            ),
        })
    } else if schema_version < MIN_SUPPORTED_DATA_SCHEMA_VERSION {
        Some(format!(
            "Local data schema {schema_version} is older than this DisCloud build supports (minimum {MIN_SUPPORTED_DATA_SCHEMA_VERSION}). Migrate the local data before using Local mode."
        ))
    } else if downgrade {
        Some(format!(
            "This local data was last used by newer DisCloud {}. This build is {}. Update DisCloud before using Local mode; manual downgrade is blocked to protect local data.",
            last_app_version.as_deref().unwrap_or("unknown"),
            current_app_version,
        ))
    } else {
        None
    };
    Ok(LocalDataCompatibility {
        schema_version,
        supported_schema_min: MIN_SUPPORTED_DATA_SCHEMA_VERSION,
        supported_schema_max: CURRENT_DATA_SCHEMA_VERSION,
        compatible: schema_compatible && !downgrade,
        last_app_version,
        detail,
    })
}

async fn read_metadata(
    layout: &LocalRuntimeLayout,
) -> Result<Option<LocalDataMetadata>, LocalRuntimeError> {
    if !fs::try_exists(&layout.data_metadata_path)
        .await
        .map_err(|error| LocalRuntimeError::io("Could not inspect local data metadata", error))?
    {
        return Ok(None);
    }
    let content = fs::read(&layout.data_metadata_path)
        .await
        .map_err(|error| LocalRuntimeError::io("Could not read local data metadata", error))?;
    serde_json::from_slice(&content).map(Some).map_err(|error| {
        LocalRuntimeError::configuration(format!("The local data metadata is invalid: {error}"))
    })
}

async fn write_metadata(
    layout: &LocalRuntimeLayout,
    metadata: &LocalDataMetadata,
) -> Result<(), LocalRuntimeError> {
    let mut content = serde_json::to_vec_pretty(metadata).map_err(|error| {
        LocalRuntimeError::internal(format!("Could not serialize local data metadata: {error}"))
    })?;
    content.push(b'\n');
    let temporary = layout.data_metadata_path.with_extension("json.tmp");
    fs::write(&temporary, content)
        .await
        .map_err(|error| LocalRuntimeError::io("Could not write local data metadata", error))?;
    if fs::try_exists(&layout.data_metadata_path)
        .await
        .map_err(|error| LocalRuntimeError::io("Could not inspect local data metadata", error))?
    {
        fs::remove_file(&layout.data_metadata_path)
            .await
            .map_err(|error| {
                LocalRuntimeError::io("Could not replace local data metadata", error)
            })?;
    }
    fs::rename(&temporary, &layout.data_metadata_path)
        .await
        .map_err(|error| LocalRuntimeError::io("Could not install local data metadata", error))
}

async fn legacy_data_exists(layout: &LocalRuntimeLayout) -> Result<bool, LocalRuntimeError> {
    for path in [
        &layout.config_path,
        &layout.manifest_path,
        &layout.postgresql_state_path,
        &layout.backend_state_path,
        &layout.web_state_path,
    ] {
        if fs::try_exists(path)
            .await
            .map_err(|error| LocalRuntimeError::io("Could not inspect legacy local data", error))?
        {
            return Ok(true);
        }
    }
    layout.database_initialized().await
}

#[cfg(test)]
mod tests {
    use super::{evaluate, CURRENT_DATA_SCHEMA_VERSION};

    #[test]
    fn accepts_current_data_schema() {
        let compatibility =
            evaluate(CURRENT_DATA_SCHEMA_VERSION, Some("1.2.3".into()), "1.2.3").unwrap();
        assert!(compatibility.compatible);
        assert!(compatibility.detail.is_none());
    }

    #[test]
    fn rejects_newer_data_schema() {
        let compatibility = evaluate(
            CURRENT_DATA_SCHEMA_VERSION + 1,
            Some("2.0.0".into()),
            "2.0.0",
        )
        .unwrap();
        assert!(!compatibility.compatible);
        assert!(compatibility
            .detail
            .as_deref()
            .is_some_and(|detail| detail.contains("Update DisCloud")));
        assert_eq!(compatibility.last_app_version.as_deref(), Some("2.0.0"));
    }

    #[test]
    fn rejects_manual_app_downgrade() {
        let compatibility = evaluate(
            CURRENT_DATA_SCHEMA_VERSION,
            Some("0.1.0-rc.15".into()),
            "0.1.0-rc.14",
        )
        .unwrap();
        assert!(!compatibility.compatible);
        assert!(compatibility
            .detail
            .as_deref()
            .is_some_and(|detail| detail.contains("manual downgrade is blocked")));
    }

    #[test]
    fn allows_newer_app_on_same_schema() {
        let compatibility = evaluate(
            CURRENT_DATA_SCHEMA_VERSION,
            Some("0.1.0-rc.14".into()),
            "0.1.0-rc.15",
        )
        .unwrap();
        assert!(compatibility.compatible);
    }
}
