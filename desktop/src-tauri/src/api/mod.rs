use std::{
    collections::HashMap,
    sync::{Arc, RwLock},
    time::Duration,
};

use reqwest::{
    cookie::{CookieStore, Jar},
    header::{HeaderName, HeaderValue, ACCEPT, CONTENT_LENGTH, COOKIE, HOST, SET_COOKIE},
    Client, Method, RequestBuilder, StatusCode, Url,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;

mod session;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const JSON_ACCEPT: &str = "application/json, application/problem+json";
const IPC_API_ROUTES: &[(&str, &str)] = &[
    ("GET", "/api/v1/setup/status"),
    ("POST", "/api/v1/setup"),
    ("POST", "/api/v1/auth/login"),
    ("POST", "/api/v1/auth/mfa/verify"),
    ("GET", "/api/v1/auth/me"),
    ("POST", "/api/v1/auth/logout"),
    ("GET", "/api/v1/me"),
    ("PATCH", "/api/v1/me"),
    ("PUT", "/api/v1/me/password"),
    ("DELETE", "/api/v1/me/avatar"),
    ("GET", "/api/v1/me/mfa"),
    ("POST", "/api/v1/me/mfa/totp/enroll"),
    ("POST", "/api/v1/me/mfa/totp/confirm"),
    ("POST", "/api/v1/me/mfa/recovery-codes/regenerate"),
    ("DELETE", "/api/v1/me/mfa/totp"),
    ("GET", "/api/v1/me/config"),
    ("PUT", "/api/v1/me/config/common"),
    ("GET", "/api/v1/workspaces/:username"),
    ("GET", "/api/v1/search"),
    ("GET", "/api/v1/shared"),
    ("GET", "/api/v1/storage/analyzer"),
    ("GET", "/api/v1/activity"),
    ("POST", "/api/v1/activity/sync"),
    ("GET", "/api/v1/users/lookup"),
    ("POST", "/api/v1/folders"),
    ("GET", "/api/v1/folders/:folderId/children"),
    ("GET", "/api/v1/folders/:folderId/breadcrumbs"),
    ("DELETE", "/api/v1/folders/:folderId"),
    ("POST", "/api/v1/folders/:folderId/restore"),
    ("DELETE", "/api/v1/folders/:folderId/permanent"),
    ("GET", "/api/v1/folders/:folderId/permissions"),
    ("PUT", "/api/v1/folders/:folderId/permissions/:userId"),
    ("DELETE", "/api/v1/folders/:folderId/permissions/:userId"),
    ("GET", "/api/v1/files/:fileId"),
    ("DELETE", "/api/v1/files/:fileId"),
    ("POST", "/api/v1/files/:fileId/restore"),
    ("DELETE", "/api/v1/files/:fileId/permanent"),
    ("GET", "/api/v1/files/:fileId/versions"),
    ("POST", "/api/v1/files/:fileId/versions/:versionId/restore"),
    ("PATCH", "/api/v1/nodes/:nodeId"),
    ("PUT", "/api/v1/nodes/:nodeId/favorite"),
    ("DELETE", "/api/v1/nodes/:nodeId/favorite"),
    ("GET", "/api/v1/trash"),
    ("GET", "/api/v1/collections"),
    ("POST", "/api/v1/collections"),
    ("GET", "/api/v1/collections/:collectionId"),
    ("PATCH", "/api/v1/collections/:collectionId"),
    ("DELETE", "/api/v1/collections/:collectionId"),
    ("POST", "/api/v1/collections/:collectionId/restore"),
    ("GET", "/api/v1/collections/:collectionId/items"),
    ("POST", "/api/v1/collections/:collectionId/items"),
    ("DELETE", "/api/v1/collections/:collectionId/items/:fileId"),
    ("GET", "/api/v1/collections/:collectionId/access"),
    ("PUT", "/api/v1/collections/:collectionId/access/:userId"),
    ("DELETE", "/api/v1/collections/:collectionId/access/:userId"),
    ("GET", "/api/v1/shares/active"),
    ("POST", "/api/v1/shares"),
    ("PATCH", "/api/v1/shares/:shareId"),
    ("DELETE", "/api/v1/shares/:shareId"),
    ("DELETE", "/api/v1/shares/:shareId/sessions"),
    ("GET", "/api/v1/admin/users"),
    ("POST", "/api/v1/admin/users"),
    ("GET", "/api/v1/admin/users/:userId"),
    ("PATCH", "/api/v1/admin/users/:userId"),
    ("PUT", "/api/v1/admin/users/:userId/quota"),
    ("POST", "/api/v1/admin/users/:userId/reset-password"),
    ("POST", "/api/v1/admin/users/:userId/enable"),
    ("POST", "/api/v1/admin/users/:userId/disable"),
    ("GET", "/api/v1/admin/storage"),
    ("POST", "/api/v1/admin/storage/reconcile"),
    ("GET", "/api/v1/admin/bots"),
    ("POST", "/api/v1/admin/bots/:botId/probe"),
    ("POST", "/api/v1/admin/bots/:botId/drain"),
    ("POST", "/api/v1/admin/bots/:botId/disable"),
    ("POST", "/api/v1/admin/bots/:botId/enable"),
    ("POST", "/api/v1/admin/bots/config/:configIndex/probe"),
    ("GET", "/api/v1/admin/audit"),
    ("GET", "/api/v1/admin/jobs"),
    ("GET", "/api/v1/admin/uploads"),
];

#[derive(Clone)]
struct DesktopApiClient {
    base_url: Url,
    client: Client,
    cookie_jar: Arc<Jar>,
}

#[derive(Clone, Default)]
pub(crate) struct ApiState {
    client: Arc<RwLock<Option<DesktopApiClient>>>,
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

impl ApiRequest {
    pub(crate) fn validate_ipc(&self) -> Result<(), ApiCommandError> {
        if !self.headers.is_empty() {
            return Err(ApiCommandError::invalid_request(
                "Custom HTTP headers are not allowed through desktop IPC.",
            ));
        }
        if self.query.len() > 64 {
            return Err(ApiCommandError::invalid_request(
                "Too many API query parameters.",
            ));
        }
        let method = self.method.to_ascii_uppercase();
        if !IPC_API_ROUTES.iter().any(|(allowed_method, pattern)| {
            method == *allowed_method && ipc_route_matches(&self.path, pattern)
        }) {
            return Err(ApiCommandError::invalid_request(
                "This API route is not available through desktop IPC.",
            ));
        }
        Ok(())
    }

    pub(crate) fn is_logout(&self) -> bool {
        self.method.eq_ignore_ascii_case("POST") && self.path == "/api/v1/auth/logout"
    }

    pub(crate) fn is_session_check(&self) -> bool {
        self.method.eq_ignore_ascii_case("GET") && self.path == "/api/v1/auth/me"
    }
}

fn ipc_route_matches(path: &str, pattern: &str) -> bool {
    let path = path.split('/').collect::<Vec<_>>();
    let pattern = pattern.split('/').collect::<Vec<_>>();
    path.len() == pattern.len()
        && path.iter().zip(pattern).all(|(segment, expected)| {
            if expected.starts_with(':') {
                ipc_dynamic_segment_allowed(segment)
            } else {
                *segment == expected
            }
        })
}

fn ipc_dynamic_segment_allowed(segment: &str) -> bool {
    if segment.is_empty()
        || segment.len() > 512
        || segment == "."
        || segment == ".."
        || segment.contains('\\')
    {
        return false;
    }
    let lower = segment.to_ascii_lowercase();
    !lower.contains("%2f") && !lower.contains("%5c")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApiResponse {
    status: u16,
    has_body: bool,
    body: Value,
}

struct ClientApiResponse {
    response: ApiResponse,
    cookies_changed: bool,
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
    #[allow(dead_code)]
    fn new(server_url: &str) -> Result<Self, ApiCommandError> {
        Self::from_base_url(normalize_server_url(server_url)?)
    }

    fn from_base_url(base_url: Url) -> Result<Self, ApiCommandError> {
        let cookie_jar = Arc::new(Jar::default());
        let client = Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .redirect(reqwest::redirect::Policy::limited(5))
            .cookie_provider(Arc::clone(&cookie_jar))
            .user_agent(concat!("DisCloud Desktop/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|error| {
                ApiCommandError::internal(format!("Could not create HTTP client: {error}"))
            })?;

        Ok(Self {
            base_url,
            client,
            cookie_jar,
        })
    }

    async fn check_readiness(&self) -> Result<(), ApiCommandError> {
        let response = self
            .client
            .get(self.endpoint("/readyz")?)
            .timeout(REQUEST_TIMEOUT)
            .send()
            .await
            .map_err(|error| ApiCommandError::network("Could not reach the server", error))?;

        if response.status() != StatusCode::NO_CONTENT {
            return Err(response_error(response).await);
        }

        Ok(())
    }

    async fn request(&self, request: ApiRequest) -> Result<ClientApiResponse, ApiCommandError> {
        let method = Method::from_bytes(request.method.as_bytes())
            .map_err(|_| ApiCommandError::invalid_request("Invalid HTTP method."))?;
        let mut url = self.endpoint(&request.path)?;

        {
            let mut query = url.query_pairs_mut();

            for (key, value) in request.query {
                query.append_pair(&key, &value);
            }
        }

        let mut builder = self
            .client
            .request(method, url)
            .header(ACCEPT, JSON_ACCEPT)
            .timeout(REQUEST_TIMEOUT);

        if let Some(body) = request.body {
            builder = builder.json(&body);
        }

        for (name, value) in request.headers {
            builder = with_request_header(builder, name, value)?;
        }

        let response = builder
            .send()
            .await
            .map_err(|error| ApiCommandError::network("API request failed", error))?;
        let cookies_changed = response.headers().contains_key(SET_COOKIE);
        let status = response.status();

        if !status.is_success() {
            return Err(response_error(response).await);
        }

        let bytes = response
            .bytes()
            .await
            .map_err(|error| ApiCommandError::network("Could not read the API response", error))?;

        let response = if bytes.is_empty() {
            ApiResponse {
                status: status.as_u16(),
                has_body: false,
                body: Value::Null,
            }
        } else {
            let body = serde_json::from_slice(&bytes).map_err(|_| {
                ApiCommandError::invalid_response("The server returned an invalid JSON response.")
            })?;

            ApiResponse {
                status: status.as_u16(),
                has_body: true,
                body,
            }
        };

        Ok(ClientApiResponse {
            response,
            cookies_changed,
        })
    }

    async fn raw_request(
        &self,
        method: Method,
        path: &str,
        query: Vec<(String, String)>,
        headers: Vec<(String, String)>,
    ) -> Result<reqwest::Response, ApiCommandError> {
        self.raw_request_inner(method, path, query, headers, None)
            .await
    }

    async fn raw_request_body(
        &self,
        method: Method,
        path: &str,
        query: Vec<(String, String)>,
        headers: Vec<(String, String)>,
        body: Vec<u8>,
    ) -> Result<reqwest::Response, ApiCommandError> {
        self.raw_request_inner(method, path, query, headers, Some(body))
            .await
    }

    async fn raw_request_inner(
        &self,
        method: Method,
        path: &str,
        query: Vec<(String, String)>,
        headers: Vec<(String, String)>,
        body: Option<Vec<u8>>,
    ) -> Result<reqwest::Response, ApiCommandError> {
        let mut url = self.endpoint(path)?;

        {
            let mut pairs = url.query_pairs_mut();

            for (key, value) in query {
                pairs.append_pair(&key, &value);
            }
        }

        let mut builder = self.client.request(method, url);

        for (name, value) in headers {
            builder = with_request_header(builder, name, value)?;
        }

        if let Some(body) = body {
            builder = builder.body(body);
        }

        builder
            .send()
            .await
            .map_err(|error| ApiCommandError::network("File request failed", error))
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

    fn cookie_header(&self) -> Option<String> {
        let url = self.endpoint("/api/v1/auth/me").ok()?;

        self.cookie_jar
            .cookies(&url)
            .and_then(|value| value.to_str().ok().map(str::to_owned))
    }

    fn restore_cookie_header(&self, header: &str) {
        let path = self.base_url.path();
        let secure = if self.base_url.scheme() == "https" {
            "; Secure"
        } else {
            ""
        };

        for cookie in header
            .split(';')
            .map(str::trim)
            .filter(|cookie| !cookie.is_empty() && cookie.contains('='))
        {
            let cookie = format!("{cookie}; Path={path}; HttpOnly{secure}");
            self.cookie_jar.add_cookie_str(&cookie, &self.base_url);
        }
    }
}

impl ApiState {
    pub(crate) async fn connect(
        &self,
        server_url: String,
    ) -> Result<ConnectedServer, ApiCommandError> {
        let base_url = normalize_server_url(&server_url)?;

        if let Some(client) = self.client_snapshot()? {
            if client.base_url == base_url {
                client.check_readiness().await?;

                return Ok(ConnectedServer {
                    server_url: canonical_server_url(&client.base_url),
                });
            }
        }

        let client = DesktopApiClient::from_base_url(base_url)?;

        client.check_readiness().await?;
        restore_persisted_session(&client).await;

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

    pub(crate) fn connected_server_url(&self) -> Result<String, ApiCommandError> {
        let client = self
            .client_snapshot()?
            .ok_or_else(ApiCommandError::not_connected)?;
        Ok(canonical_server_url(&client.base_url))
    }

    pub(crate) async fn request(
        &self,
        request: ApiRequest,
    ) -> Result<ApiResponse, ApiCommandError> {
        let validate_session = request.path == "/api/v1/auth/me";
        let client = self
            .client_snapshot()?
            .ok_or_else(ApiCommandError::not_connected)?;

        let result = client.request(request).await;

        match result {
            Ok(result) => {
                if result.cookies_changed {
                    persist_current_session(&client).await;
                }

                Ok(result.response)
            }

            Err(error) => {
                if validate_session && error.status == Some(StatusCode::UNAUTHORIZED.as_u16()) {
                    forget_persisted_session(&client).await;
                }

                Err(error)
            }
        }
    }

    pub(crate) async fn request_json<T: DeserializeOwned>(
        &self,
        method: Method,
        path: String,
        body: Option<Value>,
    ) -> Result<T, ApiCommandError> {
        let response = self
            .request(ApiRequest {
                method: method.as_str().to_string(),
                path,
                query: Vec::new(),
                headers: HashMap::new(),
                body,
            })
            .await?;

        if !response.has_body {
            return Err(ApiCommandError::invalid_response(
                "The server returned an empty JSON response.",
            ));
        }

        serde_json::from_value(response.body).map_err(|_| {
            ApiCommandError::invalid_response("The server returned an invalid JSON response.")
        })
    }

    pub(crate) async fn request_empty(
        &self,
        method: Method,
        path: String,
        body: Option<Value>,
    ) -> Result<(), ApiCommandError> {
        self.request(ApiRequest {
            method: method.as_str().to_string(),
            path,
            query: Vec::new(),
            headers: HashMap::new(),
            body,
        })
        .await?;

        Ok(())
    }

    pub(crate) async fn raw_request(
        &self,
        method: Method,
        path: &str,
        query: Vec<(String, String)>,
        headers: Vec<(String, String)>,
    ) -> Result<reqwest::Response, ApiCommandError> {
        let client = self
            .client_snapshot()?
            .ok_or_else(ApiCommandError::not_connected)?;

        client.raw_request(method, path, query, headers).await
    }

    pub(crate) async fn raw_request_body(
        &self,
        method: Method,
        path: &str,
        query: Vec<(String, String)>,
        headers: Vec<(String, String)>,
        body: Vec<u8>,
    ) -> Result<reqwest::Response, ApiCommandError> {
        let client = self
            .client_snapshot()?
            .ok_or_else(ApiCommandError::not_connected)?;

        client
            .raw_request_body(method, path, query, headers, body)
            .await
    }

    fn client_snapshot(&self) -> Result<Option<DesktopApiClient>, ApiCommandError> {
        self.client
            .read()
            .map_err(|_| ApiCommandError::internal("API state lock is poisoned."))
            .map(|client| client.clone())
    }
}

impl ApiCommandError {
    pub(crate) fn invalid_request(message: impl Into<String>) -> Self {
        Self::new("invalidRequest", message)
    }

    pub(crate) fn invalid_response(message: impl Into<String>) -> Self {
        Self::new("invalidResponse", message)
    }

    fn not_connected() -> Self {
        Self::new("notConnected", "No DisCloud server is connected.")
    }

    pub(crate) fn internal(message: impl Into<String>) -> Self {
        Self::new("internal", message)
    }

    pub(crate) fn cancelled() -> Self {
        Self::new("cancelled", "Upload cancelled")
    }

    pub(crate) fn network(context: &str, error: reqwest::Error) -> Self {
        let message = if error.is_timeout() {
            format!("{context}: request timed out.")
        } else {
            format!("{context}: {error}")
        };

        Self::new("network", message)
    }

    pub(crate) fn is_retryable_transfer(&self) -> bool {
        self.kind == "network"
            || self
                .status
                .is_some_and(|status| matches!(status, 408 | 429 | 502 | 503 | 504))
    }

    pub(crate) fn is_unauthorized(&self) -> bool {
        self.status == Some(StatusCode::UNAUTHORIZED.as_u16())
    }

    pub(crate) fn is_file_already_exists(&self) -> bool {
        self.status == Some(StatusCode::CONFLICT.as_u16())
            && self
                .problem
                .as_ref()
                .and_then(|problem| problem.detail.as_deref())
                == Some("file already exists")
    }

    pub(crate) fn is_cancelled(&self) -> bool {
        self.kind == "cancelled"
    }

    pub(crate) fn request_id(&self) -> Option<&str> {
        self.problem
            .as_ref()
            .and_then(|problem| problem.request_id.as_deref())
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

    pub(crate) fn message(&self) -> &str {
        &self.message
    }
}

pub(crate) async fn response_error(response: reqwest::Response) -> ApiCommandError {
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

async fn restore_persisted_session(client: &DesktopApiClient) {
    let server_url = canonical_server_url(&client.base_url);

    match session::load(&server_url).await {
        Ok(Some(cookie_header)) => {
            client.restore_cookie_header(&cookie_header);
        }
        Ok(None) => {}
        Err(error) => {
            session_persistence_warning("Could not restore session", &error);
        }
    }
}

async fn persist_current_session(client: &DesktopApiClient) {
    let server_url = canonical_server_url(&client.base_url);

    let result = match client.cookie_header() {
        Some(cookie_header) => session::save(&server_url, &cookie_header).await,
        None => session::delete(&server_url).await,
    };

    if let Err(error) = result {
        session_persistence_warning("Could not persist session", &error);
    }
}

async fn forget_persisted_session(client: &DesktopApiClient) {
    let server_url = canonical_server_url(&client.base_url);

    if let Err(error) = session::delete(&server_url).await {
        session_persistence_warning("Could not remove expired session", &error);
    }
}

fn session_persistence_warning(context: &str, error: &ApiCommandError) {
    let message = format!("{context}: {}", error.message());
    eprintln!("DisCloud desktop: {message}");
    crate::diagnostics::warn("session", message);
}

fn with_request_header(
    builder: RequestBuilder,
    name: String,
    value: String,
) -> Result<RequestBuilder, ApiCommandError> {
    let name = HeaderName::from_bytes(name.as_bytes())
        .map_err(|_| ApiCommandError::invalid_request("Invalid HTTP header name."))?;

    if name == COOKIE || name == HOST || name == CONTENT_LENGTH {
        return Err(ApiCommandError::invalid_request(format!(
            "The {} header is managed by the native transport.",
            name.as_str(),
        )));
    }

    let value = HeaderValue::from_str(&value)
        .map_err(|_| ApiCommandError::invalid_request("Invalid HTTP header value."))?;

    Ok(builder.header(name, value))
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
    use std::collections::HashMap;

    use super::{canonical_server_url, normalize_server_url, ApiRequest, DesktopApiClient};

    fn ipc_request(method: &str, path: &str) -> ApiRequest {
        ApiRequest {
            method: method.to_string(),
            path: path.to_string(),
            query: Vec::new(),
            headers: HashMap::new(),
            body: None,
        }
    }

    #[test]
    fn defaults_to_https() {
        let url = normalize_server_url("cloud.example.com").unwrap();
        assert_eq!(canonical_server_url(&url), "https://cloud.example.com");
    }

    #[test]
    fn preserves_http_and_base_path() {
        let url = normalize_server_url("http://localhost:8080/discloud/").unwrap();

        assert_eq!(canonical_server_url(&url), "http://localhost:8080/discloud",);
    }

    #[test]
    fn endpoint_preserves_base_path() {
        let client = DesktopApiClient::new("https://example.com/discloud").unwrap();

        assert_eq!(
            client.endpoint("/api/v1/setup/status").unwrap().as_str(),
            "https://example.com/discloud/api/v1/setup/status",
        );
    }

    #[test]
    fn restores_session_cookie_for_api_requests() {
        let client = DesktopApiClient::new("https://example.com/discloud").unwrap();

        client.restore_cookie_header("discloud_session=secret");

        assert_eq!(
            client.cookie_header().as_deref(),
            Some("discloud_session=secret"),
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

    #[test]
    fn allows_only_explicit_desktop_ipc_routes() {
        assert!(ipc_request("GET", "/api/v1/files/file-id/versions")
            .validate_ipc()
            .is_ok());
        assert!(ipc_request("POST", "/api/v1/admin/bots/config/3/probe")
            .validate_ipc()
            .is_ok());

        assert!(ipc_request("GET", "/api/v1/admin/config")
            .validate_ipc()
            .is_err());
        assert!(ipc_request("GET", "/api/v1/admin/metrics")
            .validate_ipc()
            .is_err());
        assert!(ipc_request("POST", "/api/v1/uploads")
            .validate_ipc()
            .is_err());
        assert!(ipc_request("GET", "/api/v1/files/file-id/content")
            .validate_ipc()
            .is_err());
        assert!(ipc_request("POST", "/api/v1/files/file-id/versions")
            .validate_ipc()
            .is_err());
    }

    #[test]
    fn rejects_ipc_route_smuggling_and_custom_headers() {
        assert!(ipc_request("GET", "/api/v1/files/a%2Fb/versions")
            .validate_ipc()
            .is_err());
        assert!(ipc_request("GET", "/api/v1/files/../versions")
            .validate_ipc()
            .is_err());

        let mut request = ipc_request("GET", "/api/v1/auth/me");
        request
            .headers
            .insert("X-DisCloud-Test".to_string(), "value".to_string());
        assert!(request.validate_ipc().is_err());
    }
}
