use std::{
    path::{Path, PathBuf},
    time::Duration,
};

use reqwest::{header::RANGE, Client};
use sha2::{Digest, Sha256};
use tokio::{fs, io::AsyncWriteExt};

use super::{components::RuntimeComponentDescriptor, LocalRuntimeError};

const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(10 * 60);

pub(crate) struct VerifiedDownload {
    pub(crate) path: PathBuf,
    pub(crate) sha256: String,
    pub(crate) bytes: u64,
}

pub(crate) fn client(desktop_version: &str) -> Result<Client, LocalRuntimeError> {
    Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(DOWNLOAD_TIMEOUT)
        .user_agent(format!("DisCloud Desktop/{desktop_version}"))
        .build()
        .map_err(|error| {
            LocalRuntimeError::network("Could not create the local runtime download client", error)
        })
}

pub(crate) async fn download_verified(
    client: &Client,
    descriptor: &RuntimeComponentDescriptor,
    destination_dir: &Path,
) -> Result<VerifiedDownload, LocalRuntimeError> {
    fs::create_dir_all(destination_dir).await.map_err(|error| {
        LocalRuntimeError::io("Could not create the runtime download directory", error)
    })?;

    let checksum_document = client
        .get(&descriptor.checksum_url)
        .send()
        .await
        .map_err(|error| {
            LocalRuntimeError::network("Could not download the runtime checksum", error)
        })?
        .error_for_status()
        .map_err(|error| LocalRuntimeError::network("Runtime checksum download failed", error))?
        .text()
        .await
        .map_err(|error| {
            LocalRuntimeError::network("Could not read the runtime checksum", error)
        })?;
    let expected = parse_checksum_document(&checksum_document, &descriptor.archive_name)?;

    let response = client
        .get(&descriptor.download_url)
        .send()
        .await
        .map_err(|error| {
            LocalRuntimeError::network("Could not download the runtime component", error)
        })?
        .error_for_status()
        .map_err(|error| LocalRuntimeError::network("Runtime component download failed", error))?;
    let final_path = destination_dir.join(&descriptor.archive_name);
    let temporary_path = destination_dir.join(format!(".{}.part", descriptor.archive_name));
    let _ = fs::remove_file(&temporary_path).await;

    let result = write_verified_response(response, &temporary_path, &expected).await;
    let (sha256, bytes) = match result {
        Ok(result) => result,
        Err(error) => {
            let _ = fs::remove_file(&temporary_path).await;
            return Err(error);
        }
    };

    super::atomic_file::replace(
        &temporary_path,
        &final_path,
        "Could not finalize the runtime component download",
    )
    .await?;

    Ok(VerifiedDownload {
        path: final_path,
        sha256,
        bytes,
    })
}

pub(crate) async fn verify_descriptor_available(
    client: &Client,
    descriptor: &RuntimeComponentDescriptor,
) -> Result<(), LocalRuntimeError> {
    let checksum_document = client
        .get(&descriptor.checksum_url)
        .send()
        .await
        .map_err(|error| {
            LocalRuntimeError::network("Could not download the runtime checksum", error)
        })?
        .error_for_status()
        .map_err(|error| LocalRuntimeError::network("Runtime checksum download failed", error))?
        .text()
        .await
        .map_err(|error| {
            LocalRuntimeError::network("Could not read the runtime checksum", error)
        })?;
    parse_checksum_document(&checksum_document, &descriptor.archive_name)?;
    client
        .get(&descriptor.download_url)
        .header(RANGE, "bytes=0-0")
        .send()
        .await
        .map_err(|error| {
            LocalRuntimeError::network("Could not verify the runtime component asset", error)
        })?
        .error_for_status()
        .map_err(|error| {
            LocalRuntimeError::network("Runtime component asset is unavailable", error)
        })?;
    Ok(())
}

async fn write_verified_response(
    mut response: reqwest::Response,
    path: &Path,
    expected: &str,
) -> Result<(String, u64), LocalRuntimeError> {
    let mut file = fs::File::create(path).await.map_err(|error| {
        LocalRuntimeError::io("Could not create the runtime component archive", error)
    })?;
    let mut hasher = Sha256::new();
    let mut bytes = 0_u64;

    while let Some(chunk) = response.chunk().await.map_err(|error| {
        LocalRuntimeError::network("Could not read the runtime component download", error)
    })? {
        file.write_all(&chunk).await.map_err(|error| {
            LocalRuntimeError::io("Could not write the runtime component archive", error)
        })?;
        hasher.update(&chunk);
        bytes = bytes.saturating_add(chunk.len() as u64);
    }
    file.flush().await.map_err(|error| {
        LocalRuntimeError::io("Could not flush the runtime component archive", error)
    })?;
    file.sync_all().await.map_err(|error| {
        LocalRuntimeError::io("Could not sync the runtime component archive", error)
    })?;

    let actual = hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    if actual != expected {
        return Err(LocalRuntimeError::invalid_artifact(format!(
            "SHA-256 mismatch for {}: expected {expected}, got {actual}.",
            path.file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("runtime component")
        )));
    }
    Ok((actual, bytes))
}

fn parse_checksum_document(
    document: &str,
    archive_name: &str,
) -> Result<String, LocalRuntimeError> {
    for line in document.lines().filter(|line| line.contains(archive_name)) {
        if let Some(hash) = line.split_whitespace().find_map(normalize_sha256) {
            return Ok(hash);
        }
    }

    let hashes = document
        .split_whitespace()
        .filter_map(normalize_sha256)
        .collect::<Vec<_>>();
    if hashes.len() == 1 {
        return Ok(hashes[0].clone());
    }

    Err(LocalRuntimeError::invalid_artifact(format!(
        "Could not resolve the SHA-256 checksum for {archive_name}."
    )))
}

fn normalize_sha256(value: &str) -> Option<String> {
    let value = value.trim_matches(|character: char| !character.is_ascii_hexdigit());
    (value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .then(|| value.to_ascii_lowercase())
}

#[cfg(test)]
mod tests {
    use super::parse_checksum_document;

    #[test]
    fn parses_checksum_list_by_filename() {
        let document = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa other.tar.gz\nBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB wanted.tar.gz\n";
        assert_eq!(
            parse_checksum_document(document, "wanted.tar.gz").unwrap(),
            "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        );
    }

    #[test]
    fn parses_certutil_style_sidecar() {
        let document = "SHA256 hash of file archive.tar.gz:\n9797dcf4ed6ea1f8d3610f6cc6f0382c9cb222242bc0b67763f02988b11afecc\nCertUtil: -hashfile command completed successfully.\n";
        assert_eq!(
            parse_checksum_document(document, "archive.tar.gz").unwrap(),
            "9797dcf4ed6ea1f8d3610f6cc6f0382c9cb222242bc0b67763f02988b11afecc"
        );
    }

    #[test]
    fn rejects_ambiguous_checksum_documents() {
        let document = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa a.tar.gz\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb b.tar.gz\n";
        assert!(parse_checksum_document(document, "missing.tar.gz").is_err());
    }
}
