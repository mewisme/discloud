use std::{collections::HashMap, sync::RwLock, time::Duration};

use reqwest::{
    header::{HeaderName, HeaderValue, ACCEPT, CONTENT_LENGTH, COOKIE, HOST},
    Client, Method, StatusCode, Url,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const JSON_ACCEPT: &str = "application/json, application/problem+json";

#[derive(Clone)]
struct DesktopApiClient {
    base_url: Url,
    client: Client,
}

#[derive(Default)]
pub(crate) struct ApiState {
    client: RwLock<Option<DesktopApiClient>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApiRequest {
    #[serde(default = "default_method")]
    method: String,
    path: String,
    #[serde(default)]
    query: Vec<(String, String)>,
    #[serde(default)]
    headers: HashMap<String, String>,
    body: Option<Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApiResponse {
    status: u16,
    has_body: bool,
    body: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConnectedServer {
    server_url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApiCommandError {
    kind: &'static str,
    message: String,
    status: Option<u16>,
    status_text: Option<String>,
    problem: Option<Problem>,
}

#[derive(Debug, Serialize, Deserialize)]
struct Problem {
    #[serde(rename = "type")]
    problem_type: String,
    title: String,
    status: u16,
    detail: Option<String>,
    request_id: Option<String>,
}

impl DesktopApiClient {
    fn new(server_url: &str) -> Result<Self, ApiCommandError> {
        let base_url = normalize_server_url(server_url)?;
        let client = Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(REQUEST_TIMEOUT)
            .redirect(reqwest::redirect::Policy::limited(5))
            .cookie_store(true)
            .user_agent(concat!("DisCloud Desktop/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|error| {
                ApiCommandError::internal(format!("Could not create HTTP client: {error}"))
            })?;

        Ok(Self { base_url, client })
    }

    async fn check_readiness(&self) -> Result<(), ApiCommandError> {
        let response = self
            .client
            .get(self.endpoint("/readyz")?)
            .send()
            .await
            .map_err(|error| ApiCommandError::network("Could not reach the server", error))?;

        if response.status() != StatusCode::NO_CONTENT {
            return Err(response_error(response).await);
        }

        Ok(())
    }

    async fn request(&self, request: ApiRequest) -> Result<ApiResponse, ApiCommandError> {
        let method = Method::from_bytes(request.method.as_bytes())
            .map_err(|_| ApiCommandError::invalid_request("Invalid HTTP method."))?;
        let mut url = self.endpoint(&request.path)?;

        {
            let mut query = url.query_pairs_mut();

            for (key, value) in request.query {
                query.append_pair(&key, &value);
            }
        }

        let mut builder = self.client.request(method, url).header(ACCEPT, JSON_ACCEPT);

        if let Some(body) = request.body {
            builder = builder.json(&body);
        }

        for (name, value) in request.headers {
            let name = HeaderName::from_bytes(name.as_bytes())
                .map_err(|_| ApiCommandError::invalid_request("Invalid HTTP header name."))?;

            if name == COOKIE || name == HOST || name == CONTENT_LENGTH {
                return Err(ApiCommandError::invalid_request(format!(
                    "The {} header is managed by the native transport.",
                    name.as_str()
                )));
            }

            let value = HeaderValue::from_str(&value)
                .map_err(|_| ApiCommandError::invalid_request("Invalid HTTP header value."))?;

            builder = builder.header(name, value);
        }

        let response = builder
            .send()
            .await
            .map_err(|error| ApiCommandError::network("API request failed", error))?;
        let status = response.status();

        if !status.is_success() {
            return Err(response_error(response).await);
        }

        let bytes = response
            .bytes()
            .await
            .map_err(|error| ApiCommandError::network("Could not read the API response", error))?;

        if bytes.is_empty() {
            return Ok(ApiResponse {
                status: status.as_u16(),
                has_body: false,
                body: Value::Null,
            });
        }

        let body = serde_json::from_slice(&bytes).map_err(|_| {
            ApiCommandError::invalid_response("The server returned an invalid JSON response.")
        })?;

        Ok(ApiResponse {
            status: status.as_u16(),
            has_body: true,
            body,
        })
    }

    fn endpoint(&self, path: &str) -> Result<Url, ApiCommandError> {
        if !path.starts_with('/') || path.contains('?') || path.contains('#') {
            return Err(ApiCommandError::invalid_request(
                "API paths must be absolute paths without a query or fragment.",
            ));
        }

        let relative = path.trim_start_matches('/');

        if relative
            .split('/')
            .any(|segment| segment == "." || segment == "..")
        {
            return Err(ApiCommandError::invalid_request("Invalid API path."));
        }

        self.base_url
            .join(relative)
            .map_err(|_| ApiCommandError::invalid_request("Could not build the API URL."))
    }
}

impl ApiState {
    pub(crate) async fn connect(
        &self,
        server_url: String,
    ) -> Result<ConnectedServer, ApiCommandError> {
        let client = DesktopApiClient::new(&server_url)?;

        client.check_readiness().await?;

        let server_url = canonical_server_url(&client.base_url);

        *self
            .client
            .write()
            .map_err(|_| ApiCommandError::internal("API state lock is poisoned."))? = Some(client);

        Ok(ConnectedServer { server_url })
    }

    pub(crate) fn disconnect(&self) -> Result<(), ApiCommandError> {
        *self
            .client
            .write()
            .map_err(|_| ApiCommandError::internal("API state lock is poisoned."))? = None;

        Ok(())
    }

    pub(crate) async fn request(
        &self,
        request: ApiRequest,
    ) -> Result<ApiResponse, ApiCommandError> {
        let client = self
            .client
            .read()
            .map_err(|_| ApiCommandError::internal("API state lock is poisoned."))?
            .clone()
            .ok_or_else(ApiCommandError::not_connected)?;

        client.request(request).await
    }
}

impl ApiCommandError {
    fn invalid_request(message: impl Into<String>) -> Self {
        Self::new("invalidRequest", message)
    }

    fn invalid_response(message: impl Into<String>) -> Self {
        Self::new("invalidResponse", message)
    }

    fn not_connected() -> Self {
        Self::new("notConnected", "No DisCloud server is connected.")
    }

    fn internal(message: impl Into<String>) -> Self {
        Self::new("internal", message)
    }

    fn network(context: &str, error: reqwest::Error) -> Self {
        let message = if error.is_timeout() {
            format!("{context}: request timed out.")
        } else {
            format!("{context}: {error}")
        };

        Self::new("network", message)
    }

    fn http(status: StatusCode, problem: Option<Problem>) -> Self {
        let status_text = status.canonical_reason().unwrap_or("").to_string();
        let message = problem
            .as_ref()
            .and_then(|problem| problem.detail.clone())
            .or_else(|| problem.as_ref().map(|problem| problem.title.clone()))
            .unwrap_or_else(|| format!("{} {}", status.as_u16(), status_text));

        Self {
            kind: "http",
            message,
            status: Some(status.as_u16()),
            status_text: Some(status_text),
            problem,
        }
    }

    fn new(kind: &'static str, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            status: None,
            status_text: None,
            problem: None,
        }
    }
}

async fn response_error(response: reqwest::Response) -> ApiCommandError {
    let status = response.status();
    let is_problem = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .is_some_and(|value| value.trim() == "application/problem+json");
    let problem = if is_problem {
        response.json::<Problem>().await.ok()
    } else {
        None
    };

    ApiCommandError::http(status, problem)
}

fn normalize_server_url(value: &str) -> Result<Url, ApiCommandError> {
    let value = value.trim();

    if value.is_empty() {
        return Err(ApiCommandError::invalid_request(
            "Enter a DisCloud server URL.",
        ));
    }

    let candidate = if value.contains("://") {
        value.to_string()
    } else {
        format!("https://{value}")
    };

    let mut url = Url::parse(&candidate)
        .map_err(|_| ApiCommandError::invalid_request("Enter a valid HTTP or HTTPS server URL."))?;

    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err(ApiCommandError::invalid_request(
            "Enter a valid HTTP or HTTPS server URL.",
        ));
    }

    if !url.username().is_empty() || url.password().is_some() {
        return Err(ApiCommandError::invalid_request(
            "Server URLs cannot contain credentials.",
        ));
    }

    if url.query().is_some() || url.fragment().is_some() {
        return Err(ApiCommandError::invalid_request(
            "Server URLs cannot contain a query or fragment.",
        ));
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

fn default_method() -> String {
    "GET".to_string()
}

#[cfg(test)]
mod tests {
    use super::{canonical_server_url, normalize_server_url, DesktopApiClient};

    #[test]
    fn defaults_to_https() {
        let url = normalize_server_url("cloud.example.com").unwrap();

        assert_eq!(canonical_server_url(&url), "https://cloud.example.com");
    }

    #[test]
    fn preserves_http_and_base_path() {
        let url = normalize_server_url("http://localhost:8080/discloud/").unwrap();

        assert_eq!(canonical_server_url(&url), "http://localhost:8080/discloud");
    }

    #[test]
    fn endpoint_preserves_base_path() {
        let client = DesktopApiClient::new("https://example.com/discloud").unwrap();

        assert_eq!(
            client.endpoint("/api/v1/setup/status").unwrap().as_str(),
            "https://example.com/discloud/api/v1/setup/status"
        );
    }

    #[test]
    fn rejects_non_http_protocols() {
        assert!(normalize_server_url("ftp://example.com").is_err());
    }

    #[test]
    fn rejects_parent_path_segments() {
        let client = DesktopApiClient::new("https://example.com").unwrap();

        assert!(client.endpoint("/api/../secret").is_err());
    }
}
