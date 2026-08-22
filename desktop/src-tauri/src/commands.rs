use std::time::Duration;

use reqwest::{header::ACCEPT, Client, StatusCode, Url};
use serde::{Deserialize, Serialize};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetupStatus {
    setup_required: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ServerProbe {
    server_url: String,
    setup_required: bool,
}

#[tauri::command]
pub(crate) async fn probe_server(server_url: String) -> Result<ServerProbe, String> {
    let base_url = normalize_server_url(&server_url)?;
    let client = Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .redirect(reqwest::redirect::Policy::limited(5))
        .user_agent(concat!("DisCloud Desktop/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| format!("Could not create HTTP client: {error}"))?;

    let readiness_url = base_url
        .join("readyz")
        .map_err(|_| "Could not build the readiness URL.".to_string())?;

    let readiness = client
        .get(readiness_url)
        .send()
        .await
        .map_err(|error| request_error("Could not reach the server", error))?;

    if readiness.status() != StatusCode::NO_CONTENT {
        return Err(format!(
            "DisCloud readiness check failed with HTTP {}.",
            readiness.status().as_u16()
        ));
    }

    let setup_url = base_url
        .join("api/v1/setup/status")
        .map_err(|_| "Could not build the setup status URL.".to_string())?;

    let setup_response = client
        .get(setup_url)
        .header(ACCEPT, "application/json, application/problem+json")
        .send()
        .await
        .map_err(|error| request_error("Could not check the setup status", error))?;

    if setup_response.status() != StatusCode::OK {
        return Err(format!(
            "DisCloud setup status check failed with HTTP {}.",
            setup_response.status().as_u16()
        ));
    }

    let setup_status = setup_response
        .json::<SetupStatus>()
        .await
        .map_err(|_| "The server returned an invalid setup status response.".to_string())?;

    Ok(ServerProbe {
        server_url: canonical_server_url(&base_url),
        setup_required: setup_status.setup_required,
    })
}

fn normalize_server_url(value: &str) -> Result<Url, String> {
    let value = value.trim();

    if value.is_empty() {
        return Err("Enter a DisCloud server URL.".to_string());
    }

    let candidate = if value.contains("://") {
        value.to_string()
    } else {
        format!("https://{value}")
    };

    let mut url =
        Url::parse(&candidate).map_err(|_| "Enter a valid HTTP or HTTPS server URL.".to_string())?;

    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("Enter a valid HTTP or HTTPS server URL.".to_string());
    }

    if !url.username().is_empty() || url.password().is_some() {
        return Err("Server URLs cannot contain credentials.".to_string());
    }

    if url.query().is_some() || url.fragment().is_some() {
        return Err("Server URLs cannot contain a query or fragment.".to_string());
    }

    let path = url.path().trim_end_matches('/').to_string();
    let path = if path.is_empty() {
        "/".to_string()
    } else {
        format!("{path}/")
    };

    url.set_path(&path);

    Ok(url)
}

fn canonical_server_url(url: &Url) -> String {
    url.as_str().trim_end_matches('/').to_string()
}

fn request_error(context: &str, error: reqwest::Error) -> String {
    if error.is_timeout() {
        return format!("{context}: request timed out.");
    }

    format!("{context}: {error}")
}

#[cfg(test)]
mod tests {
    use super::{canonical_server_url, normalize_server_url};

    #[test]
    fn defaults_to_https() {
        let url = normalize_server_url("cloud.example.com").unwrap();

        assert_eq!(canonical_server_url(&url), "https://cloud.example.com");
    }

    #[test]
    fn preserves_http_and_base_path() {
        let url = normalize_server_url("http://localhost:8080/discloud/").unwrap();

        assert_eq!(
            canonical_server_url(&url),
            "http://localhost:8080/discloud"
        );
        assert_eq!(
            url.join("readyz").unwrap().as_str(),
            "http://localhost:8080/discloud/readyz"
        );
    }

    #[test]
    fn rejects_non_http_protocols() {
        assert!(normalize_server_url("ftp://example.com").is_err());
    }
}