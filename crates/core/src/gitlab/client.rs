use std::collections::{HashMap, VecDeque};
use std::fmt;
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use crate::exec::Exec;
use crate::git::model::DiffFile;
use crate::gitlab::model::{
    convert_gitlab_diffs, Discussion, GitLabChangesRaw, GitLabDiffRaw, GitLabProject, GitLabUser,
    JobInfo, MergeRequest, MrListQuery, PageInfo, PaginatedList, PersonalAccessToken, PipelineInfo,
    TokenScopeMode,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitLabError {
    Unauthorized(String),
    Forbidden(String),
    NotFound(String),
    RateLimited { retry_after: u64, message: String },
    Http { status: u16, message: String },
    Network(String),
    Parse(String),
    Git(String),
    AuthTokenNotFound(String),
    InvalidRemoteUrl(String),
}

impl fmt::Display for GitLabError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unauthorized(msg) => write!(f, "GitLab Unauthorized (401): {}", msg),
            Self::Forbidden(msg) => write!(f, "GitLab Forbidden (403): {}", msg),
            Self::NotFound(msg) => write!(f, "GitLab Not Found (404): {}", msg),
            Self::RateLimited {
                retry_after,
                message,
            } => write!(
                f,
                "GitLab Rate Limited (429, retry after {}s): {}",
                retry_after, message
            ),
            Self::Http { status, message } => {
                write!(f, "GitLab HTTP {} error: {}", status, message)
            }
            Self::Network(msg) => write!(f, "GitLab network error: {}", msg),
            Self::Parse(msg) => write!(f, "GitLab JSON parse error: {}", msg),
            Self::Git(msg) => write!(f, "Git error: {}", msg),
            Self::AuthTokenNotFound(msg) => write!(f, "GitLab auth token not found: {}", msg),
            Self::InvalidRemoteUrl(msg) => write!(f, "Invalid remote URL: {}", msg),
        }
    }
}

impl std::error::Error for GitLabError {}

#[derive(Clone)]
struct CacheEntry {
    etag: Option<String>,
    body: String,
    created_at: Instant,
    ttl: Option<Duration>,
    size_bytes: usize,
}

pub struct GitLabCache {
    entries: HashMap<String, CacheEntry>,
    order: VecDeque<String>,
    current_bytes: usize,
    max_bytes: usize,
}

impl GitLabCache {
    pub fn new(max_bytes: usize) -> Self {
        Self {
            entries: HashMap::new(),
            order: VecDeque::new(),
            current_bytes: 0,
            max_bytes,
        }
    }

    pub fn get(&mut self, key: &str) -> Option<(Option<String>, String, bool)> {
        let (etag, body, is_fresh) = {
            let entry = self.entries.get(key)?;
            let is_fresh = match entry.ttl {
                Some(ttl) => entry.created_at.elapsed() < ttl,
                None => true, // immutable
            };
            (entry.etag.clone(), entry.body.clone(), is_fresh)
        };

        // Move key to the end of order queue for LRU tracking
        if let Some(pos) = self.order.iter().position(|k| k == key) {
            self.order.remove(pos);
            self.order.push_back(key.to_string());
        }

        Some((etag, body, is_fresh))
    }

    pub fn insert(
        &mut self,
        key: String,
        etag: Option<String>,
        body: String,
        ttl: Option<Duration>,
    ) {
        let entry_size = key.len() + body.len() + etag.as_ref().map(|s| s.len()).unwrap_or(0);
        if entry_size > self.max_bytes {
            // Cannot fit in cache
            return;
        }

        // If replacing an existing key, adjust size
        if let Some(old) = self.entries.remove(&key) {
            self.current_bytes = self.current_bytes.saturating_sub(old.size_bytes);
            if let Some(pos) = self.order.iter().position(|k| k == &key) {
                self.order.remove(pos);
            }
        }

        // Evict until space is available
        while self.current_bytes + entry_size > self.max_bytes {
            if let Some(old_key) = self.order.pop_front() {
                if let Some(old_entry) = self.entries.remove(&old_key) {
                    self.current_bytes = self.current_bytes.saturating_sub(old_entry.size_bytes);
                }
            } else {
                break;
            }
        }

        let entry = CacheEntry {
            etag,
            body,
            created_at: Instant::now(),
            ttl,
            size_bytes: entry_size,
        };

        self.current_bytes += entry_size;
        self.order.push_back(key.clone());
        self.entries.insert(key, entry);
    }

    pub fn touch(&mut self, key: &str) {
        if let Some(entry) = self.entries.get_mut(key) {
            entry.created_at = Instant::now();
        }
        if let Some(pos) = self.order.iter().position(|k| k == key) {
            let k = self.order.remove(pos).unwrap();
            self.order.push_back(k);
        }
    }

    pub fn invalidate_all(&mut self) {
        self.entries.clear();
        self.order.clear();
        self.current_bytes = 0;
    }

    pub fn invalidate_prefix(&mut self, prefix: &str) {
        let keys_to_remove: Vec<String> = self
            .entries
            .keys()
            .filter(|k| k.starts_with(prefix))
            .cloned()
            .collect();

        for key in keys_to_remove {
            if let Some(entry) = self.entries.remove(&key) {
                self.current_bytes = self.current_bytes.saturating_sub(entry.size_bytes);
            }
            if let Some(pos) = self.order.iter().position(|k| k == &key) {
                self.order.remove(pos);
            }
        }
    }
}

static GLOBAL_CACHE: OnceLock<Arc<Mutex<GitLabCache>>> = OnceLock::new();

pub fn global_cache() -> Arc<Mutex<GitLabCache>> {
    GLOBAL_CACHE
        .get_or_init(|| Arc::new(Mutex::new(GitLabCache::new(2 * 1024 * 1024))))
        .clone()
}

pub struct GitLabClient {
    base_url: String,
    token: Option<String>,
    agent: ureq::Agent,
    cache: Arc<Mutex<GitLabCache>>,
    auto_retry_429: bool,
    max_retry_after: Duration,
}

impl GitLabClient {
    pub fn new(base_url: String, token: Option<String>) -> Self {
        let agent = ureq::AgentBuilder::new()
            .timeout(Duration::from_secs(20))
            .build();
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            token,
            agent,
            cache: global_cache(),
            auto_retry_429: false,
            max_retry_after: Duration::from_secs(10),
        }
    }

    pub fn with_cache(
        base_url: String,
        token: Option<String>,
        cache: Arc<Mutex<GitLabCache>>,
    ) -> Self {
        let mut client = Self::new(base_url, token);
        client.cache = cache;
        client
    }

    pub fn set_auto_retry_429(&mut self, enabled: bool, max_wait: Duration) {
        self.auto_retry_429 = enabled;
        self.max_retry_after = max_wait;
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub fn has_token(&self) -> bool {
        self.token.is_some()
    }

    pub fn invalidate_cache(&self) {
        if let Ok(mut lock) = self.cache.lock() {
            lock.invalidate_all();
        }
    }

    pub fn from_repo(
        exec: &dyn Exec,
        repo: &Path,
        remote_name: Option<&str>,
    ) -> Result<(Self, String), GitLabError> {
        let remotes =
            crate::git::remote::remotes(exec, repo).map_err(|e| GitLabError::Git(e.to_string()))?;

        let target_name = remote_name.unwrap_or("origin");
        let remote = remotes
            .iter()
            .find(|r| r.name == target_name)
            .or_else(|| remotes.first())
            .ok_or_else(|| GitLabError::Git("No git remotes configured in repo".to_string()))?;

        let remote_url = remote
            .fetch_url
            .as_deref()
            .or(remote.push_url.as_deref())
            .ok_or_else(|| {
                GitLabError::Git(format!("Remote '{}' has no URL configured", remote.name))
            })?;

        let (base_url, host, project_path) = parse_remote_url(remote_url)?;

        let token = resolve_token_from_git_credential(exec, repo, &host).ok();
        let client = Self::new(base_url, token);

        Ok((client, project_path))
    }

    pub fn get_raw_url(&self, url: &str) -> Result<String, GitLabError> {
        let (body, _) = self.execute_get(url, None, true)?;
        Ok(body)
    }

    fn cache_key(&self, url: &str) -> String {
        if let Some(token) = &self.token {
            use sha2::Digest;
            let mut hasher = sha2::Sha256::new();
            hasher.update(token.as_bytes());
            let hash = format!("{:x}", hasher.finalize());
            format!("{}:{}", &hash[..8], url)
        } else {
            format!("anon:{}", url)
        }
    }

    fn execute_get(
        &self,
        url: &str,
        ttl: Option<Duration>,
        force_fresh: bool,
    ) -> Result<(String, Option<ureq::Response>), GitLabError> {
        let key = self.cache_key(url);
        let cached = if force_fresh {
            None
        } else {
            let mut lock = self.cache.lock().unwrap();
            lock.get(&key)
        };

        if let Some((_, body, is_fresh)) = &cached {
            if *is_fresh {
                return Ok((body.clone(), None));
            }
        }

        let mut req = self.agent.get(url);
        if let Some(token) = &self.token {
            req = req.set("PRIVATE-TOKEN", token);
        }

        if let Some((Some(ref etag), _, _)) = cached {
            req = req.set("If-None-Match", etag);
        }

        match req.call() {
            Ok(resp) => {
                let etag = resp.header("ETag").map(|s| s.to_string());
                let resp_headers = resp;
                let body = resp_headers
                    .into_string()
                    .map_err(|e| GitLabError::Network(e.to_string()))?;

                {
                    let mut lock = self.cache.lock().unwrap();
                    lock.insert(key, etag, body.clone(), ttl);
                }

                Ok((body, None))
            }
            Err(ureq::Error::Status(304, _)) => {
                {
                    let mut lock = self.cache.lock().unwrap();
                    lock.touch(&key);
                }
                if let Some((_, body, _)) = cached {
                    Ok((body, None))
                } else {
                    Err(GitLabError::Http {
                        status: 304,
                        message: "Not Modified".to_string(),
                    })
                }
            }
            Err(ureq::Error::Status(429, resp)) => {
                let retry_after = resp
                    .header("Retry-After")
                    .and_then(|v| v.parse::<u64>().ok())
                    .unwrap_or(5);
                let message = resp.into_string().unwrap_or_default();

                if self.auto_retry_429 && Duration::from_secs(retry_after) <= self.max_retry_after {
                    std::thread::sleep(Duration::from_secs(retry_after));
                    self.execute_get(url, ttl, true)
                } else {
                    Err(GitLabError::RateLimited {
                        retry_after,
                        message,
                    })
                }
            }
            Err(ureq::Error::Status(401, resp)) => {
                let msg = resp.into_string().unwrap_or_default();
                Err(GitLabError::Unauthorized(msg))
            }
            Err(ureq::Error::Status(403, resp)) => {
                let msg = resp.into_string().unwrap_or_default();
                Err(GitLabError::Forbidden(msg))
            }
            Err(ureq::Error::Status(404, resp)) => {
                let msg = resp.into_string().unwrap_or_default();
                Err(GitLabError::NotFound(msg))
            }
            Err(ureq::Error::Status(status, resp)) => {
                let msg = resp.into_string().unwrap_or_default();
                Err(GitLabError::Http {
                    status,
                    message: msg,
                })
            }
            Err(ureq::Error::Transport(e)) => Err(GitLabError::Network(e.to_string())),
        }
    }

    pub fn get_token_scope(&self) -> Result<TokenScopeMode, GitLabError> {
        let url = format!("{}/api/v4/personal_access_tokens/self", self.base_url);
        let (body, _) = self.execute_get(&url, Some(Duration::from_secs(60)), false)?;
        let pat: PersonalAccessToken =
            serde_json::from_str(&body).map_err(|e| GitLabError::Parse(e.to_string()))?;
        Ok(TokenScopeMode::from_scopes(&pat.scopes))
    }

    pub fn get_personal_access_token(&self) -> Result<PersonalAccessToken, GitLabError> {
        let url = format!("{}/api/v4/personal_access_tokens/self", self.base_url);
        let (body, _) = self.execute_get(&url, Some(Duration::from_secs(60)), false)?;
        serde_json::from_str(&body).map_err(|e| GitLabError::Parse(e.to_string()))
    }

    pub fn get_current_user(&self) -> Result<GitLabUser, GitLabError> {
        let url = format!("{}/api/v4/user", self.base_url);
        let (body, _) = self.execute_get(&url, Some(Duration::from_secs(120)), false)?;
        serde_json::from_str(&body).map_err(|e| GitLabError::Parse(e.to_string()))
    }

    pub fn get_project(&self, project_id_or_path: &str) -> Result<GitLabProject, GitLabError> {
        let encoded = url_encode_path(project_id_or_path);
        let url = format!("{}/api/v4/projects/{}", self.base_url, encoded);
        let (body, _) = self.execute_get(&url, Some(Duration::from_secs(300)), false)?;
        serde_json::from_str(&body).map_err(|e| GitLabError::Parse(e.to_string()))
    }

    pub fn resolve_project_id(&self, project_path_or_id: &str) -> Result<u64, GitLabError> {
        if let Ok(id) = project_path_or_id.parse::<u64>() {
            return Ok(id);
        }
        let project = self.get_project(project_path_or_id)?;
        Ok(project.id)
    }

    pub fn list_merge_requests(
        &self,
        project_id: &str,
        query: &MrListQuery,
    ) -> Result<PaginatedList<MergeRequest>, GitLabError> {
        let page = query.page.unwrap_or(1);
        let per_page = query.per_page.unwrap_or(30);

        let mut params = Vec::new();
        params.push(format!("page={}", page));
        params.push(format!("per_page={}", per_page));

        if let Some(ref st) = query.state {
            params.push(format!("state={}", st));
        }
        if let Some(ref sc) = query.scope {
            params.push(format!("scope={}", sc));
        }
        if let Some(rev_id) = query.reviewer_id {
            params.push(format!("reviewer_id={}", rev_id));
        }
        if let Some(ref s) = query.search {
            params.push(format!("search={}", url_encode_path(s)));
        }

        let query_str = params.join("&");
        let url = format!(
            "{}/api/v4/projects/{}/merge_requests?{}",
            self.base_url,
            url_encode_path(project_id),
            query_str
        );

        let key = self.cache_key(&url);

        // We execute direct call with ureq to parse headers alongside body
        let cached = {
            let mut lock = self.cache.lock().unwrap();
            lock.get(&key)
        };

        if let Some((_, body, is_fresh)) = &cached {
            if *is_fresh {
                let items: Vec<MergeRequest> =
                    serde_json::from_str(body).map_err(|e| GitLabError::Parse(e.to_string()))?;
                return Ok(PaginatedList {
                    items,
                    pagination: PageInfo {
                        page,
                        per_page,
                        next_page: None,
                        total_pages: None,
                        total: None,
                    },
                });
            }
        }

        let mut req = self.agent.get(&url);
        if let Some(token) = &self.token {
            req = req.set("PRIVATE-TOKEN", token);
        }
        if let Some((Some(ref etag), _, _)) = cached {
            req = req.set("If-None-Match", etag);
        }

        let resp = match req.call() {
            Ok(r) => r,
            Err(ureq::Error::Status(304, _)) => {
                {
                    let mut lock = self.cache.lock().unwrap();
                    lock.touch(&key);
                }
                if let Some((_, body, _)) = cached {
                    let items: Vec<MergeRequest> = serde_json::from_str(&body)
                        .map_err(|e| GitLabError::Parse(e.to_string()))?;
                    return Ok(PaginatedList {
                        items,
                        pagination: PageInfo {
                            page,
                            per_page,
                            next_page: None,
                            total_pages: None,
                            total: None,
                        },
                    });
                } else {
                    return Err(GitLabError::Http {
                        status: 304,
                        message: "Not Modified".to_string(),
                    });
                }
            }
            Err(ureq::Error::Status(429, resp)) => {
                let retry_after = resp
                    .header("Retry-After")
                    .and_then(|v| v.parse::<u64>().ok())
                    .unwrap_or(5);
                return Err(GitLabError::RateLimited {
                    retry_after,
                    message: resp.into_string().unwrap_or_default(),
                });
            }
            Err(ureq::Error::Status(401, resp)) => {
                return Err(GitLabError::Unauthorized(
                    resp.into_string().unwrap_or_default(),
                ));
            }
            Err(ureq::Error::Status(403, resp)) => {
                return Err(GitLabError::Forbidden(
                    resp.into_string().unwrap_or_default(),
                ));
            }
            Err(ureq::Error::Status(404, resp)) => {
                return Err(GitLabError::NotFound(
                    resp.into_string().unwrap_or_default(),
                ));
            }
            Err(ureq::Error::Status(status, resp)) => {
                return Err(GitLabError::Http {
                    status,
                    message: resp.into_string().unwrap_or_default(),
                });
            }
            Err(ureq::Error::Transport(e)) => return Err(GitLabError::Network(e.to_string())),
        };

        let page_info = PageInfo {
            page: resp
                .header("X-Page")
                .and_then(|s| s.parse().ok())
                .unwrap_or(page),
            per_page: resp
                .header("X-Per-Page")
                .and_then(|s| s.parse().ok())
                .unwrap_or(per_page),
            next_page: resp.header("X-Next-Page").and_then(|s| s.parse().ok()),
            total_pages: resp.header("X-Total-Pages").and_then(|s| s.parse().ok()),
            total: resp.header("X-Total").and_then(|s| s.parse().ok()),
        };

        let etag = resp.header("ETag").map(|s| s.to_string());
        let body = resp
            .into_string()
            .map_err(|e| GitLabError::Network(e.to_string()))?;

        {
            let mut lock = self.cache.lock().unwrap();
            lock.insert(
                key,
                etag,
                body.clone(),
                Some(Duration::from_secs(30)),
            );
        }

        let items: Vec<MergeRequest> =
            serde_json::from_str(&body).map_err(|e| GitLabError::Parse(e.to_string()))?;

        Ok(PaginatedList {
            items,
            pagination: page_info,
        })
    }

    pub fn get_merge_request(
        &self,
        project_id: &str,
        iid: u64,
    ) -> Result<MergeRequest, GitLabError> {
        let url = format!(
            "{}/api/v4/projects/{}/merge_requests/{}",
            self.base_url,
            url_encode_path(project_id),
            iid
        );
        let (body, _) = self.execute_get(&url, Some(Duration::from_secs(30)), false)?;
        serde_json::from_str(&body).map_err(|e| GitLabError::Parse(e.to_string()))
    }

    pub fn get_pipelines(
        &self,
        project_id: &str,
        iid: u64,
    ) -> Result<Vec<PipelineInfo>, GitLabError> {
        let url = format!(
            "{}/api/v4/projects/{}/merge_requests/{}/pipelines",
            self.base_url,
            url_encode_path(project_id),
            iid
        );
        let (body, _) = self.execute_get(&url, Some(Duration::from_secs(15)), false)?;
        serde_json::from_str(&body).map_err(|e| GitLabError::Parse(e.to_string()))
    }

    pub fn get_pipeline_jobs(
        &self,
        project_id: &str,
        pipeline_id: u64,
    ) -> Result<Vec<JobInfo>, GitLabError> {
        let url = format!(
            "{}/api/v4/projects/{}/pipelines/{}/jobs",
            self.base_url,
            url_encode_path(project_id),
            pipeline_id
        );
        let (body, _) = self.execute_get(&url, Some(Duration::from_secs(15)), false)?;
        serde_json::from_str(&body).map_err(|e| GitLabError::Parse(e.to_string()))
    }

    pub fn get_discussions(
        &self,
        project_id: &str,
        iid: u64,
    ) -> Result<Vec<Discussion>, GitLabError> {
        let url = format!(
            "{}/api/v4/projects/{}/merge_requests/{}/discussions?per_page=100",
            self.base_url,
            url_encode_path(project_id),
            iid
        );
        let (body, _) = self.execute_get(&url, Some(Duration::from_secs(15)), false)?;
        serde_json::from_str(&body).map_err(|e| GitLabError::Parse(e.to_string()))
    }

    pub fn get_diffs(
        &self,
        project_id: &str,
        iid: u64,
        head_sha: Option<&str>,
    ) -> Result<Vec<DiffFile>, GitLabError> {
        let ttl = if head_sha.is_some() {
            None
        } else {
            Some(Duration::from_secs(60))
        };

        let diffs_url = format!(
            "{}/api/v4/projects/{}/merge_requests/{}/diffs?per_page=100",
            self.base_url,
            url_encode_path(project_id),
            iid
        );

        match self.execute_get(&diffs_url, ttl, false) {
            Ok((body, _)) => {
                let raw_diffs: Vec<GitLabDiffRaw> =
                    serde_json::from_str(&body).map_err(|e| GitLabError::Parse(e.to_string()))?;
                Ok(convert_gitlab_diffs(&raw_diffs))
            }
            Err(GitLabError::NotFound(_)) => {
                // Fallback to legacy /changes endpoint
                let changes_url = format!(
                    "{}/api/v4/projects/{}/merge_requests/{}/changes",
                    self.base_url,
                    url_encode_path(project_id),
                    iid
                );
                let (body, _) = self.execute_get(&changes_url, ttl, false)?;
                let changes_raw: GitLabChangesRaw =
                    serde_json::from_str(&body).map_err(|e| GitLabError::Parse(e.to_string()))?;
                Ok(convert_gitlab_diffs(&changes_raw.changes))
            }
            Err(err) => Err(err),
        }
    }
}

pub fn url_encode_path(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.' {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{:02X}", b));
        }
    }
    out
}

pub fn parse_remote_url(remote_url: &str) -> Result<(String, String, String), GitLabError> {
    let raw = remote_url.trim();
    if raw.is_empty() {
        return Err(GitLabError::InvalidRemoteUrl(
            "Empty remote URL".to_string(),
        ));
    }

    if let Some(rest) = raw.strip_prefix("https://") {
        parse_http_url(rest, "https")
    } else if let Some(rest) = raw.strip_prefix("http://") {
        parse_http_url(rest, "http")
    } else if let Some(rest) = raw.strip_prefix("ssh://") {
        parse_ssh_uri(rest)
    } else if raw.contains('@') && raw.contains(':') {
        parse_scp_syntax(raw)
    } else {
        Err(GitLabError::InvalidRemoteUrl(format!(
            "Unrecognized remote URL format: {}",
            raw
        )))
    }
}

fn parse_http_url(rest: &str, scheme: &str) -> Result<(String, String, String), GitLabError> {
    let after_user = match rest.find('@') {
        Some(idx) => &rest[idx + 1..],
        None => rest,
    };

    let (host, path) = match after_user.find('/') {
        Some(idx) => (&after_user[..idx], &after_user[idx + 1..]),
        None => (after_user, ""),
    };

    if host.is_empty() {
        return Err(GitLabError::InvalidRemoteUrl(
            "Missing host in URL".to_string(),
        ));
    }

    let project_path = clean_project_path(path);
    if project_path.is_empty() {
        return Err(GitLabError::InvalidRemoteUrl(
            "Missing project path in URL".to_string(),
        ));
    }

    let base_url = format!("{}://{}", scheme, host);
    Ok((base_url, host.to_string(), project_path))
}

fn parse_ssh_uri(rest: &str) -> Result<(String, String, String), GitLabError> {
    let after_user = match rest.find('@') {
        Some(idx) => &rest[idx + 1..],
        None => rest,
    };

    let (host_port, path) = match after_user.find('/') {
        Some(idx) => (&after_user[..idx], &after_user[idx + 1..]),
        None => (after_user, ""),
    };

    let host = match host_port.find(':') {
        Some(idx) => &host_port[..idx],
        None => host_port,
    };

    if host.is_empty() {
        return Err(GitLabError::InvalidRemoteUrl(
            "Missing host in SSH URL".to_string(),
        ));
    }

    let project_path = clean_project_path(path);
    if project_path.is_empty() {
        return Err(GitLabError::InvalidRemoteUrl(
            "Missing project path in SSH URL".to_string(),
        ));
    }

    let base_url = format!("https://{}", host);
    Ok((base_url, host.to_string(), project_path))
}

fn parse_scp_syntax(raw: &str) -> Result<(String, String, String), GitLabError> {
    let after_at = match raw.find('@') {
        Some(idx) => &raw[idx + 1..],
        None => raw,
    };

    let (host, path) = match after_at.find(':') {
        Some(idx) => (&after_at[..idx], &after_at[idx + 1..]),
        None => {
            return Err(GitLabError::InvalidRemoteUrl(
                "Missing colon in SCP-syntax git URL".to_string(),
            ))
        }
    };

    if host.is_empty() {
        return Err(GitLabError::InvalidRemoteUrl(
            "Missing host in SCP URL".to_string(),
        ));
    }

    let project_path = clean_project_path(path);
    if project_path.is_empty() {
        return Err(GitLabError::InvalidRemoteUrl(
            "Missing project path in SCP URL".to_string(),
        ));
    }

    let base_url = format!("https://{}", host);
    Ok((base_url, host.to_string(), project_path))
}

fn clean_project_path(path: &str) -> String {
    let trimmed = path.trim_matches('/');
    trimmed
        .strip_suffix(".git")
        .unwrap_or(trimmed)
        .trim_matches('/')
        .to_string()
}

pub fn resolve_token_from_git_credential(
    exec: &dyn Exec,
    cwd: &Path,
    host: &str,
) -> Result<String, GitLabError> {
    let input = format!("protocol=https\nhost={}\n\n", host);
    let output = exec
        .run(
            cwd,
            "git",
            &["credential", "fill"],
            &[],
            Some(input.as_bytes()),
        )
        .map_err(|e| GitLabError::Git(format!("Failed to run git credential fill: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(GitLabError::AuthTokenNotFound(format!(
            "git credential fill exited with {:?}: {}",
            output.status.code(),
            stderr.trim()
        )));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        let line = line.trim();
        if let Some(pw) = line.strip_prefix("password=") {
            if !pw.is_empty() {
                return Ok(pw.to_string());
            }
        }
    }

    Err(GitLabError::AuthTokenNotFound(format!(
        "No password/token found from git credential fill for host {}",
        host
    )))
}
