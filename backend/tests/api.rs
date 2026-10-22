use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tempfile::TempDir;
use tower::ServiceExt;
use yuimi_blog_server::{AppState, Config, router};

const TOKEN: &str = "test-only-secret-token-with-at-least-32-bytes";
struct App {
    router: Router,
    config: Config,
    _directory: TempDir,
}
impl App {
    async fn new(limit: usize) -> Self {
        let directory = tempfile::tempdir().unwrap();
        let config = Config {
            bind: "127.0.0.1:0".parse().unwrap(),
            data_dir: directory.path().join("data"),
            admin_token: TOKEN.into(),
            max_upload_bytes: limit,
        };
        let state = AppState::open(config.clone()).await.unwrap();
        Self {
            router: router(state),
            config,
            _directory: directory,
        }
    }
    async fn send(
        &self,
        method: &str,
        uri: &str,
        body: Option<Value>,
        auth: bool,
    ) -> (StatusCode, Value) {
        let mut request = Request::builder().method(method).uri(uri);
        if auth {
            request = request.header("authorization", format!("Bearer {TOKEN}"));
        }
        if body.is_some() {
            request = request.header("content-type", "application/json");
        }
        let response = self
            .router
            .clone()
            .oneshot(
                request
                    .body(Body::from(body.map(|v| v.to_string()).unwrap_or_default()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = response.status();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        (status, value)
    }
    async fn create(&self, published: bool) -> Value {
        let (status, article) = self
            .send(
                "POST",
                "/api/admin/articles",
                Some(article(published)),
                true,
            )
            .await;
        assert_eq!(status, StatusCode::CREATED, "{article}");
        article
    }
    async fn upload(&self, id: &str, data: Vec<u8>) -> (StatusCode, Value) {
        let response = self
            .router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/admin/articles/{id}/attachments"))
                    .header("authorization", format!("Bearer {TOKEN}"))
                    .header(
                        "content-type",
                        "multipart/form-data; boundary=upload-boundary",
                    )
                    .body(Body::from(data))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = response.status();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }
    fn file_count(&self) -> usize {
        std::fs::read_dir(self.config.data_dir.join("uploads"))
            .unwrap()
            .count()
    }
}
fn article(published: bool) -> Value {
    json!({"title":"测试文章", "slug":"hello-rust", "description":"文章摘要", "content_markdown":"## 标题\n\n正文 **加粗**", "tags":["Rust","后端"], "category":"tech", "published":published})
}
fn multipart(content: &[u8], filename: &str) -> Vec<u8> {
    let mut body = format!("--upload-boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\nContent-Type: application/octet-stream\r\n\r\n").into_bytes();
    body.extend_from_slice(content);
    body.extend_from_slice(b"\r\n--upload-boundary--\r\n");
    body
}

#[tokio::test]
async fn article_lifecycle_hides_drafts_and_requires_authentication() {
    let app = App::new(1024).await;
    assert_eq!(
        app.send("POST", "/api/admin/articles", Some(article(true)), false)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        app.send("GET", "/api/admin/articles", None, false).await.0,
        StatusCode::UNAUTHORIZED
    );
    let created = app.create(false).await;
    let id = created["id"].as_str().unwrap();
    assert_eq!(
        app.send("GET", "/api/articles", None, false).await.1["total"],
        0
    );
    assert_eq!(
        app.send("GET", "/api/articles/hello-rust", None, false)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        app.send("GET", "/api/admin/articles", None, true).await.1["total"],
        1
    );
    let (status, published) = app
        .send(
            "PUT",
            &format!("/api/admin/articles/{id}"),
            Some(article(true)),
            true,
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert!(published["published_at"].is_string());
    let detail = app
        .send("GET", "/api/articles/hello-rust", None, false)
        .await
        .1;
    assert!(
        detail["content_html"]
            .as_str()
            .unwrap()
            .contains("<strong>加粗</strong>")
    );
    assert_eq!(
        app.send("DELETE", &format!("/api/admin/articles/{id}"), None, true)
            .await
            .0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        app.send("GET", "/api/articles/hello-rust", None, false)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn duplicate_slugs_input_validation_and_markdown_sanitization() {
    let app = App::new(1024).await;
    app.create(true).await;
    assert_eq!(
        app.send("POST", "/api/admin/articles", Some(article(true)), true)
            .await
            .0,
        StatusCode::CONFLICT
    );
    for slug in ["../escape", "upperCase", "", "a/b", "-begin", "end-"] {
        let mut payload = article(true);
        payload["slug"] = json!(slug);
        assert_eq!(
            app.send("POST", "/api/admin/articles", Some(payload), true)
                .await
                .0,
            StatusCode::BAD_REQUEST
        );
    }
    let (_, rendered) = app.send("POST", "/api/admin/preview", Some(json!({"content_markdown":"<script>alert(1)</script><img src=x onerror=alert(1)>\n\n[x](javascript:alert(2))"})), true).await;
    let html = rendered["content_html"].as_str().unwrap();
    assert!(
        !html.contains("<script") && !html.contains("onerror") && !html.contains("javascript:")
    );
    assert_eq!(
        app.send(
            "POST",
            "/api/admin/articles",
            Some(json!({"title": 5})),
            true
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
}

#[tokio::test]
async fn pagination_filters_and_literal_search() {
    let app = App::new(1024).await;
    app.create(true).await;
    let mut second = article(true);
    second["slug"] = json!("second");
    second["category"] = json!("life");
    second["title"] = json!("生活日记");
    second["tags"] = json!([]);
    app.send("POST", "/api/admin/articles", Some(second), true)
        .await;
    let (_, page) = app
        .send("GET", "/api/articles?page=2&per_page=1", None, false)
        .await;
    assert_eq!(page["total"], 2);
    assert_eq!(page["items"].as_array().unwrap().len(), 1);
    assert_eq!(
        app.send("GET", "/api/articles?category=life", None, false)
            .await
            .1["total"],
        1
    );
    assert_eq!(
        app.send("GET", "/api/articles?q=Rust", None, false).await.1["total"],
        1
    );
    assert_eq!(
        app.send("GET", "/api/articles?q=%27%20OR%201%3D1--", None, false)
            .await
            .1["total"],
        0
    );
    assert_eq!(
        app.send("GET", "/api/articles?page=0", None, false).await.0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        app.send("GET", "/api/articles?per_page=101", None, false)
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        app.send("GET", "/api/articles?category=unknown", None, false)
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
}

#[tokio::test]
async fn attachment_permissions_unicode_filename_ranges_head_and_unpublishing() {
    let app = App::new(1024).await;
    let article = app.create(false).await;
    let id = article["id"].as_str().unwrap();
    let (status, attachment) = app
        .upload(id, multipart(b"file contents", "../报告.txt"))
        .await;
    assert_eq!(status, StatusCode::CREATED, "{attachment}");
    assert_eq!(attachment["filename"], "报告.txt");
    let file_id = attachment["id"].as_str().unwrap();
    let url = attachment["download_url"].as_str().unwrap();
    assert_eq!(
        app.send("GET", url, None, false).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        app.send(
            "GET",
            &format!("/api/admin/attachments/{file_id}/download"),
            None,
            true
        )
        .await
        .0,
        StatusCode::OK
    );
    app.send(
        "PUT",
        &format!("/api/admin/articles/{id}"),
        Some(crate::article(true)),
        true,
    )
    .await;
    let response = app
        .router
        .clone()
        .oneshot(
            Request::builder()
                .uri(url)
                .header("range", "bytes=0-3")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(
        response.headers()["content-type"],
        "application/octet-stream"
    );
    assert_eq!(response.headers()["x-content-type-options"], "nosniff");
    assert_eq!(response.headers()["cache-control"], "no-store");
    assert!(
        response.headers()["content-disposition"]
            .to_str()
            .unwrap()
            .contains("filename*=UTF-8''%E6%8A%A5%E5%91%8A%2Etxt")
    );
    assert_eq!(
        response.into_body().collect().await.unwrap().to_bytes(),
        "file"
    );
    let response = app
        .router
        .clone()
        .oneshot(
            Request::builder()
                .method("HEAD")
                .uri(url)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["content-length"], "13");
    assert!(
        response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes()
            .is_empty()
    );
    app.send(
        "PUT",
        &format!("/api/admin/articles/{id}"),
        Some(crate::article(false)),
        true,
    )
    .await;
    assert_eq!(
        app.send("GET", url, None, false).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        app.send(
            "DELETE",
            &format!("/api/admin/attachments/{file_id}"),
            None,
            true
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(app.file_count(), 0);
}

#[tokio::test]
async fn rejected_uploads_do_not_leave_files() {
    let app = App::new(8).await;
    let article = app.create(false).await;
    let id = article["id"].as_str().unwrap();
    assert_eq!(
        app.upload(id, multipart(b"123456789", "large.txt")).await.0,
        StatusCode::PAYLOAD_TOO_LARGE
    );
    assert_eq!(app.file_count(), 0);
    let mut two_files = multipart(b"abc", "first.txt");
    two_files.truncate(two_files.len() - b"--upload-boundary--\r\n".len());
    two_files.extend_from_slice(&multipart(b"def", "second.txt"));
    assert_eq!(app.upload(id, two_files).await.0, StatusCode::BAD_REQUEST);
    assert_eq!(app.file_count(), 0);
    assert_eq!(
        app.upload(id, multipart(b"", "empty.txt")).await.0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(app.file_count(), 0);
    let mut body = multipart(b"abc", "broken.txt");
    body.truncate(body.len() - 20);
    assert_eq!(app.upload(id, body).await.0, StatusCode::BAD_REQUEST);
    assert_eq!(app.file_count(), 0);
    let (_, detail) = app
        .send("GET", &format!("/api/admin/articles/{id}"), None, true)
        .await;
    assert_eq!(detail["attachments"], json!([]));
    assert_eq!(
        app.upload(
            "00000000-0000-0000-0000-000000000000",
            multipart(b"a", "a.txt")
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn configured_upload_limit_overrides_the_default_two_megabyte_body_limit() {
    let app = App::new(3 * 1024 * 1024).await;
    let article = app.create(false).await;
    let size = 2 * 1024 * 1024 + 128;
    let (status, attachment) = app
        .upload(
            article["id"].as_str().unwrap(),
            multipart(&vec![42; size], "large.bin"),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{attachment}");
    assert_eq!(attachment["size"], size);
    assert_eq!(app.file_count(), 1);
}

#[tokio::test]
async fn deleting_article_cascades_attachment_metadata_and_disk_file() {
    let app = App::new(1024).await;
    let article = app.create(true).await;
    let id = article["id"].as_str().unwrap();
    let (_, attachment) = app.upload(id, multipart(b"persist me", "a.txt")).await;
    assert_eq!(app.file_count(), 1);
    app.send("DELETE", &format!("/api/admin/articles/{id}"), None, true)
        .await;
    assert_eq!(app.file_count(), 0);
    assert_eq!(
        app.send(
            "GET",
            attachment["download_url"].as_str().unwrap(),
            None,
            false
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn database_and_uploads_survive_reopening() {
    let app = App::new(1024).await;
    let article = app.create(true).await;
    let (_, attachment) = app
        .upload(
            article["id"].as_str().unwrap(),
            multipart(b"durable", "durable.txt"),
        )
        .await;
    let reopened = router(AppState::open(app.config.clone()).await.unwrap());
    let response = reopened
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/articles/hello-rust")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body: Value =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(body["attachments"][0]["id"], attachment["id"]);
    let response = reopened
        .oneshot(
            Request::builder()
                .uri(attachment["download_url"].as_str().unwrap())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        response.into_body().collect().await.unwrap().to_bytes(),
        "durable"
    );
}

#[tokio::test]
async fn removed_custom_pages_and_private_paths_are_not_served() {
    let app = App::new(1024).await;
    for path in [
        "/manage/",
        "/articles/",
        "/articles/hello-rust",
        "/backend-assets/style.css",
        "/.env",
        "/data/blog.sqlite3",
        "/uploads/anything",
        "/api/unknown",
    ] {
        assert_eq!(
            app.send("GET", path, None, false).await.0,
            StatusCode::NOT_FOUND,
            "{path}"
        );
    }
    let request = Request::builder()
        .uri("/api/admin/articles")
        .header("authorization", "Bearer incorrect-token")
        .body(Body::empty())
        .unwrap();
    assert_eq!(
        app.router.oneshot(request).await.unwrap().status(),
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn concurrent_duplicate_creation_only_inserts_one_article() {
    let app = App::new(1024).await;
    let (one, two) = tokio::join!(
        app.send("POST", "/api/admin/articles", Some(article(true)), true),
        app.send("POST", "/api/admin/articles", Some(article(true)), true)
    );
    let mut statuses = [one.0.as_u16(), two.0.as_u16()];
    statuses.sort();
    assert_eq!(statuses, [201, 409]);
    assert_eq!(
        app.send("GET", "/api/articles", None, false).await.1["total"],
        1
    );
}

#[tokio::test]
async fn placeholder_admin_tokens_are_rejected() {
    let app = App::new(1024).await;
    let mut config = app.config;
    config.admin_token = "replace-with-a-random-secret-of-at-least-32-characters".into();
    assert!(config.validate().is_err());
    config.admin_token = "short".into();
    assert!(config.validate().is_err());
}
