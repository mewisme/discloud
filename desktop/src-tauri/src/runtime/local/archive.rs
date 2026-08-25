use std::{
    fs::File,
    path::{Path, PathBuf},
};

use flate2::read::GzDecoder;
use tokio::fs;
use zip::ZipArchive;

use super::LocalRuntimeError;

pub(super) async fn extract_tar_gz(
    archive_path: &Path,
    destination: &Path,
) -> Result<(), LocalRuntimeError> {
    if fs::try_exists(destination).await.map_err(|error| {
        LocalRuntimeError::io("Could not inspect the extraction directory", error)
    })? {
        fs::remove_dir_all(destination).await.map_err(|error| {
            LocalRuntimeError::io("Could not reset the extraction directory", error)
        })?;
    }
    fs::create_dir_all(destination).await.map_err(|error| {
        LocalRuntimeError::io("Could not create the extraction directory", error)
    })?;

    let archive_path = archive_path.to_path_buf();
    let destination = destination.to_path_buf();
    tokio::task::spawn_blocking(move || extract_tar_gz_blocking(&archive_path, &destination))
        .await
        .map_err(|error| {
            LocalRuntimeError::internal(format!("Runtime archive extraction task failed: {error}"))
        })??;
    Ok(())
}

pub(super) async fn extract_zip(
    archive_path: &Path,
    destination: &Path,
) -> Result<(), LocalRuntimeError> {
    reset_destination(destination).await?;
    let archive_path = archive_path.to_path_buf();
    let destination = destination.to_path_buf();
    tokio::task::spawn_blocking(move || extract_zip_blocking(&archive_path, &destination))
        .await
        .map_err(|error| {
            LocalRuntimeError::internal(format!("Runtime archive extraction task failed: {error}"))
        })??;
    Ok(())
}

async fn reset_destination(destination: &Path) -> Result<(), LocalRuntimeError> {
    if fs::try_exists(destination).await.map_err(|error| {
        LocalRuntimeError::io("Could not inspect the extraction directory", error)
    })? {
        fs::remove_dir_all(destination).await.map_err(|error| {
            LocalRuntimeError::io("Could not reset the extraction directory", error)
        })?;
    }
    fs::create_dir_all(destination)
        .await
        .map_err(|error| LocalRuntimeError::io("Could not create the extraction directory", error))
}

fn extract_tar_gz_blocking(
    archive_path: &PathBuf,
    destination: &PathBuf,
) -> Result<(), LocalRuntimeError> {
    let file = File::open(archive_path)
        .map_err(|error| LocalRuntimeError::io("Could not open the runtime archive", error))?;
    let decoder = GzDecoder::new(file);
    let mut archive = tar::Archive::new(decoder);
    let entries = archive.entries().map_err(|error| {
        LocalRuntimeError::invalid_artifact(format!("Could not read the runtime archive: {error}"))
    })?;

    for entry in entries {
        let mut entry = entry.map_err(|error| {
            LocalRuntimeError::invalid_artifact(format!(
                "Could not read a runtime archive entry: {error}"
            ))
        })?;
        let unpacked = entry.unpack_in(destination).map_err(|error| {
            LocalRuntimeError::invalid_artifact(format!(
                "Could not extract a runtime archive entry: {error}"
            ))
        })?;
        if !unpacked {
            return Err(LocalRuntimeError::invalid_artifact(
                "Runtime archive contains a path outside the extraction directory.",
            ));
        }
    }
    Ok(())
}

fn extract_zip_blocking(
    archive_path: &PathBuf,
    destination: &PathBuf,
) -> Result<(), LocalRuntimeError> {
    let file = File::open(archive_path)
        .map_err(|error| LocalRuntimeError::io("Could not open the runtime archive", error))?;
    let mut archive = ZipArchive::new(file).map_err(|error| {
        LocalRuntimeError::invalid_artifact(format!("Could not read the runtime archive: {error}"))
    })?;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|error| {
            LocalRuntimeError::invalid_artifact(format!(
                "Could not read a runtime archive entry: {error}"
            ))
        })?;
        let Some(relative) = entry.enclosed_name() else {
            return Err(LocalRuntimeError::invalid_artifact(
                "Runtime archive contains a path outside the extraction directory.",
            ));
        };
        let path = destination.join(relative);
        if entry.is_dir() {
            std::fs::create_dir_all(&path).map_err(|error| {
                LocalRuntimeError::io("Could not create an extracted directory", error)
            })?;
            continue;
        }
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                LocalRuntimeError::io("Could not create an extracted directory", error)
            })?;
        }
        let mut output = File::create(&path)
            .map_err(|error| LocalRuntimeError::io("Could not create an extracted file", error))?;
        std::io::copy(&mut entry, &mut output).map_err(|error| {
            LocalRuntimeError::io("Could not extract a runtime archive entry", error)
        })?;
    }
    Ok(())
}
