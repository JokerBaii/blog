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
#[tokio::test]
async fn page_content_is_authenticated_validated_and_persistent() {
    let app = App::new(1024).await;
    let (status, mut content) = app.send("GET", "/api/page-content", None, false).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(content["identity"]["loveSince"], "2026-05-01");
    content["identity"]["bio"] = json!("Updated profile");
    let mut link = content["links"][0].clone();
    link["id"] = json!("new-site");
    link["name"] = json!("New bookmark");
    content["links"].as_array_mut().unwrap().push(link);
    assert_eq!(
        app.send(
            "PUT",
            "/api/admin/page-content",
            Some(content.clone()),
            false
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        app.send(
            "PUT",
            "/api/admin/page-content",
            Some(content.clone()),
            true
        )
        .await
        .0,
        StatusCode::OK
    );
    let mut invalid = content.clone();
    invalid["links"][0]["href"] = json!("javascript:alert(1)");
    assert_eq!(
        app.send("PUT", "/api/admin/page-content", Some(invalid), true)
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    let mut invalid = content.clone();
    invalid["projects"][0]["id"] = json!("unknown-project");
    assert_eq!(
        app.send("PUT", "/api/admin/page-content", Some(invalid), true)
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    let state = AppState::open(app.config.clone()).await.unwrap();
    let response = router(state)
        .oneshot(
            Request::builder()
                .uri("/api/page-content")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let saved: Value =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(saved, content);
}
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
    async fn submit(&self, id: Option<&str>, input: Value, files: Vec<u8>) -> (StatusCode, Value) {
        let mut data = format!("--upload-boundary\r\nContent-Disposition: form-data; name=\"article\"\r\n\r\n{input}\r\n").into_bytes();
        data.extend(files);
        let response = self
            .router
            .clone()
            .oneshot(
                Request::builder()
                    .method(if id.is_some() { "PUT" } else { "POST" })
                    .uri(id.map_or_else(
                        || "/api/admin/articles".into(),
                        |id| format!("/api/admin/articles/{id}"),
                    ))
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
    // Fixtures use the same article-and-files transaction as the editor.
    async fn save_attachment(&self, id: &str, files: Vec<u8>) -> (StatusCode, Value) {
        let (_, before) = self
            .send("GET", &format!("/api/admin/articles/{id}"), None, true)
            .await;
        let mut input = article(false);
        for (key, value) in input.as_object_mut().unwrap() {
            if let Some(saved) = before.get(key) {
                *value = saved.clone();
            }
        }
        let (status, saved) = self.submit(Some(id), input, files).await;
        if !status.is_success() {
            return (status, saved);
        }
        let attachment = saved["attachments"]
            .as_array()
            .unwrap()
            .iter()
            .find(|file| {
                !before["attachments"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|old| old["id"] == file["id"])
            })
            .unwrap()
            .clone();
        (status, attachment)
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
    let mut body = format!("--upload-boundary\r\nContent-Disposition: form-data; name=\"file-00000000-0000-4000-8000-000000000001\"; filename=\"{filename}\"\r\nContent-Type: application/octet-stream\r\n\r\n").into_bytes();
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
    for slug in ["../escape", "upperCase", "a/b", "-begin", "end-"] {
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
async fn article_addresses_are_generated_unique_and_stable() {
    let app = App::new(1024).await;
    let mut payload = article(true);
    payload.as_object_mut().unwrap().remove("slug");
    let (status, first) = app
        .send("POST", "/api/admin/articles", Some(payload.clone()), true)
        .await;
    assert_eq!(status, StatusCode::CREATED);
    let (status, second) = app
        .send("POST", "/api/admin/articles", Some(payload.clone()), true)
        .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_ne!(first["slug"], second["slug"]);
    payload["title"] = json!("重命名的文章");
    let uri = format!("/api/admin/articles/{}", first["id"].as_str().unwrap());
    let (status, updated) = app.send("PUT", &uri, Some(payload.clone()), true).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(updated["slug"], first["slug"]);
    payload["slug"] = json!("");
    let (status, updated) = app.send("PUT", &uri, Some(payload.clone()), true).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(updated["slug"], first["slug"]);
    assert_eq!(
        app.send("POST", "/api/admin/articles", Some(payload), true)
            .await
            .0,
        StatusCode::CREATED
    );
    assert_eq!(
        app.send(
            "GET",
            &format!("/api/articles/{}", first["slug"].as_str().unwrap()),
            None,
            false
        )
        .await
        .0,
        StatusCode::OK
    );
}

#[tokio::test]
async fn guests_cannot_mutate_site_content_or_use_admin_tools() {
    let app = App::new(1024).await;
    let created = app.create(true).await;
    let id = created["id"].as_str().unwrap();
    for (method, path, body) in [
        (
            "POST",
            "/api/admin/articles".to_string(),
            Some(article(true)),
        ),
        (
            "PUT",
            format!("/api/admin/articles/{id}"),
            Some(article(true)),
        ),
        ("DELETE", format!("/api/admin/articles/{id}"), None),
        (
            "PUT",
            "/api/admin/page-content".to_string(),
            Some(json!({})),
        ),
        (
            "POST",
            "/api/admin/preview".to_string(),
            Some(json!({"content_markdown":"hello"})),
        ),
        ("GET", "/api/admin/session".to_string(), None),
    ] {
        assert_eq!(
            app.send(method, &path, body, false).await.0,
            StatusCode::UNAUTHORIZED
        );
    }
    assert_eq!(
        app.send("GET", "/api/articles/hello-rust", None, false)
            .await
            .0,
        StatusCode::OK
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
        .save_attachment(id, multipart(b"file contents", "../报告.txt"))
        .await;
    assert_eq!(status, StatusCode::OK, "{attachment}");
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
async fn legacy_word_counts_are_backfilled_in_batches_and_lists_use_the_cache() {
    let directory = tempfile::tempdir().unwrap();
    let data_dir = directory.path().join("data");
    std::fs::create_dir_all(&data_dir).unwrap();
    let config = Config {
        bind: "127.0.0.1:0".parse().unwrap(),
        data_dir: data_dir.clone(),
        admin_token: TOKEN.into(),
        max_upload_bytes: 1024,
    };
    let db = sqlx::SqlitePool::connect_with(
        sqlx::sqlite::SqliteConnectOptions::new()
            .filename(data_dir.join("blog.sqlite3"))
            .create_if_missing(true),
    )
    .await
    .unwrap();
    let legacy = include_str!("../src/schema.sql").replace(
        "    word_count INTEGER NOT NULL DEFAULT 0 CHECK (word_count >= 0),\n",
        "",
    );
    sqlx::raw_sql(&legacy).execute(&db).await.unwrap();
    for index in 0..65 {
        sqlx::query("INSERT INTO articles(id,slug,title,content_markdown,category,published,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
            .bind(uuid::Uuid::new_v4().to_string()).bind(format!("legacy-{index}")).bind("原有文章")
            .bind("你好 Rust world").bind("tech").bind(true).bind("2020-01-01T00:00:00Z").bind("2020-01-01T00:00:00Z")
            .execute(&db).await.unwrap();
    }
    let app = App {
        router: router(AppState::open(config.clone()).await.unwrap()),
        config,
        _directory: directory,
    };
    let (status, list) = app
        .send("GET", "/api/articles?per_page=100", None, false)
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list["items"].as_array().unwrap().len(), 65);
    for item in list["items"].as_array().unwrap() {
        assert_eq!(item["word_count"], 4);
        assert_eq!(item["updated_at"], "2020-01-01T00:00:00Z");
        assert!(item.get("content_markdown").is_none());
    }
    sqlx::query("UPDATE articles SET word_count = 99 WHERE slug = 'legacy-0'")
        .execute(&db)
        .await
        .unwrap();
    // Old Markdown must not be reparsed per request.
    let (_, list) = app
        .send("GET", "/api/articles?per_page=100", None, false)
        .await;
    let cached = list["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["slug"] == "legacy-0")
        .unwrap();
    assert_eq!(cached["word_count"], 99);
    let mut input = article(true);
    input["slug"] = json!("legacy-0");
    input["content_markdown"] = json!("hello");
    let (status, updated) = app
        .send(
            "PUT",
            &format!("/api/admin/articles/{}", cached["id"].as_str().unwrap()),
            Some(input),
            true,
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(updated["word_count"], 1);
}

#[tokio::test]
async fn administrators_can_reopen_drafts_by_slug_without_exposing_them_publicly() {
    let app = App::new(1024).await;
    let saved = app.create(false).await;
    let path = "/api/admin/articles/by-slug/hello-rust";
    assert_eq!(
        app.send("GET", path, None, false).await.0,
        StatusCode::UNAUTHORIZED
    );
    let (status, draft) = app.send("GET", path, None, true).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(draft, saved);
    assert_eq!(
        app.send("GET", "/api/articles/hello-rust", None, false)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        app.send("GET", "/api/admin/articles/by-slug/missing", None, true)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        app.send("GET", "/api/admin/articles/by-slug/-invalid", None, true)
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
}

#[tokio::test]
async fn attachment_deletion_cleans_markdown_atomically_without_touching_other_content() {
    let app = App::new(1024).await;
    let saved = app.create(true).await;
    let article_id = saved["id"].as_str().unwrap();
    let (_, removed) = app
        .save_attachment(article_id, multipart(b"one", "one.txt"))
        .await;
    let (_, kept) = app
        .save_attachment(article_id, multipart(b"two", "two.txt"))
        .await;
    let href = removed["download_url"].as_str().unwrap();
    let other_href = kept["download_url"].as_str().unwrap();
    let markdown = format!(
        "正文保留\n\n- [已改过名字]({href})\n- [其他附件]({other_href})\n\n![图片]({href}?raw=1)\n\n[引用][file]\n\n[file]: {href}\n\n`[代码示例]({href})`\n\n```md\n[示例]({href})\n```\n"
    );
    let mut input = article(true);
    input["content_markdown"] = json!(markdown);
    let (_, before) = app
        .send(
            "PUT",
            &format!("/api/admin/articles/{article_id}"),
            Some(input),
            true,
        )
        .await;
    let endpoint = format!("/api/admin/attachments/{}", removed["id"].as_str().unwrap());
    assert_eq!(
        app.send("DELETE", &endpoint, None, false).await.0,
        StatusCode::UNAUTHORIZED
    );
    let db = sqlx::SqlitePool::connect_with(
        sqlx::sqlite::SqliteConnectOptions::new()
            .filename(app.config.data_dir.join("blog.sqlite3")),
    )
    .await
    .unwrap();
    sqlx::query("CREATE TRIGGER fail_attachment_delete BEFORE DELETE ON attachments BEGIN SELECT RAISE(ABORT, 'test rollback'); END").execute(&db).await.unwrap();
    assert_eq!(
        app.send("DELETE", &endpoint, None, true).await.0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    let (_, unchanged) = app
        .send("GET", "/api/articles/hello-rust", None, false)
        .await;
    assert_eq!(unchanged, before);
    assert_eq!(app.file_count(), 2);
    sqlx::query("DROP TRIGGER fail_attachment_delete")
        .execute(&db)
        .await
        .unwrap();
    assert_eq!(
        app.send("DELETE", &endpoint, None, true).await.0,
        StatusCode::NO_CONTENT
    );
    let (_, after) = app
        .send("GET", "/api/articles/hello-rust", None, false)
        .await;
    let content = after["content_markdown"].as_str().unwrap();
    assert!(content.contains("正文保留"));
    assert!(content.contains(&format!("[其他附件]({other_href})")));
    assert!(!content.contains("已改过名字"));
    assert!(!content.contains("![图片]"));
    assert!(!content.contains("[引用]"));
    assert!(!content.contains("[file]:"));
    assert!(content.contains(&format!("`[代码示例]({href})`")));
    assert!(content.contains(&format!("```md\n[示例]({href})\n```")));
    assert_eq!(after["published"], true);
    assert_eq!(after["title"], before["title"]);
    assert_eq!(after["attachments"].as_array().unwrap().len(), 1);
    assert_eq!(
        app.send("GET", href, None, false).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        app.send("GET", other_href, None, false).await.0,
        StatusCode::OK
    );
    assert_eq!(app.file_count(), 1);
    assert_eq!(
        app.send("DELETE", &endpoint, None, true).await.0,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn rejected_uploads_do_not_leave_files() {
    let app = App::new(8).await;
    let article = app.create(false).await;
    let id = article["id"].as_str().unwrap();
    assert_eq!(
        app.save_attachment(id, multipart(b"123456789", "large.txt"))
            .await
            .0,
        StatusCode::PAYLOAD_TOO_LARGE
    );
    assert_eq!(app.file_count(), 0);
    let mut two_files = multipart(b"abc", "first.txt");
    two_files.truncate(two_files.len() - b"--upload-boundary--\r\n".len());
    two_files.extend_from_slice(&multipart(b"def", "second.txt"));
    assert_eq!(
        app.save_attachment(id, two_files).await.0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(app.file_count(), 0);
    assert_eq!(
        app.save_attachment(id, multipart(b"", "empty.txt")).await.0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(app.file_count(), 0);
    let mut body = multipart(b"abc", "broken.txt");
    body.truncate(body.len() - 20);
    assert_eq!(
        app.save_attachment(id, body).await.0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(app.file_count(), 0);
    let (_, detail) = app
        .send("GET", &format!("/api/admin/articles/{id}"), None, true)
        .await;
    assert_eq!(detail["attachments"], json!([]));
    assert_eq!(
        app.save_attachment(
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
        .save_attachment(
            article["id"].as_str().unwrap(),
            multipart(&vec![42; size], "large.bin"),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{attachment}");
    assert_eq!(attachment["size"], size);
    assert_eq!(app.file_count(), 1);
}

#[tokio::test]
async fn deleting_article_cascades_attachment_metadata_and_disk_file() {
    let app = App::new(1024).await;
    let article = app.create(true).await;
    let id = article["id"].as_str().unwrap();
    let (_, attachment) = app
        .save_attachment(id, multipart(b"persist me", "a.txt"))
        .await;
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
        .save_attachment(
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
    let saved = app.create(false).await;
    assert_eq!(
        app.send(
            "POST",
            &format!(
                "/api/admin/articles/{}/attachments",
                saved["id"].as_str().unwrap()
            ),
            None,
            true
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(app.file_count(), 0);
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

async fn avatar_upload(app: &App, bytes: &[u8], authorized: bool) -> axum::response::Response {
    let mut request = Request::builder().method("POST").uri("/api/admin/avatar");
    if authorized {
        request = request.header("authorization", format!("Bearer {TOKEN}"));
    }
    app.router
        .clone()
        .oneshot(request.body(Body::from(bytes.to_vec())).unwrap())
        .await
        .unwrap()
}

#[tokio::test]
async fn avatar_requires_auth_validates_type_and_persists() {
    let app = App::new(1024).await;
    let png = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR\0\0\0\x01\0\0\0\x01";
    assert_eq!(
        avatar_upload(&app, png, false).await.status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        avatar_upload(&app, b"<svg onload='alert(1)'></svg>", true)
            .await
            .status(),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        avatar_upload(&app, png, true).await.status(),
        StatusCode::OK
    );
    let reopened = router(AppState::open(app.config.clone()).await.unwrap());
    let response = reopened
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/avatar")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["content-type"], "image/png");
    assert_eq!(response.headers()["x-content-type-options"], "nosniff");
    let etag = response.headers()["etag"].clone();
    assert_eq!(
        &response.into_body().collect().await.unwrap().to_bytes()[..],
        png
    );
    let response = reopened
        .oneshot(
            Request::builder()
                .uri("/api/avatar")
                .header("if-none-match", etag)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_MODIFIED);
    assert_eq!(
        avatar_upload(&app, &vec![0; 2 * 1024 * 1024 + 1], true)
            .await
            .status(),
        StatusCode::PAYLOAD_TOO_LARGE
    );
}

#[tokio::test]
async fn admin_account_login_and_session_logout() {
    let app = App::new(1024).await;
    let credentials = json!({"username":"jokerbai", "password":"test42"});
    let (code, _) = app
        .send(
            "POST",
            "/api/admin/account",
            Some(credentials.clone()),
            false,
        )
        .await;
    assert_eq!(code, StatusCode::UNAUTHORIZED);
    let (code, _) = app
        .send(
            "POST",
            "/api/admin/account",
            Some(credentials.clone()),
            true,
        )
        .await;
    assert_eq!(code, StatusCode::OK);
    let (code, _) = app
        .send(
            "POST",
            "/api/admin/account",
            Some(credentials.clone()),
            true,
        )
        .await;
    assert_eq!(code, StatusCode::CONFLICT);
    let (code, _) = app
        .send(
            "POST",
            "/api/auth/login",
            Some(json!({"username":"jokerbai","password":"an-incorrect-password"})),
            false,
        )
        .await;
    assert_eq!(code, StatusCode::UNAUTHORIZED);
    let (code, login) = app
        .send("POST", "/api/auth/login", Some(credentials), false)
        .await;
    assert_eq!(code, StatusCode::OK);
    let session = login["token"].as_str().unwrap();
    assert_ne!(session, TOKEN);
    assert_eq!(login["expires_in"], 2592000);
    // Sessions survive reopening the persisted database, not just page refreshes.
    let reopened = router(AppState::open(app.config.clone()).await.unwrap());
    let response = reopened
        .oneshot(
            Request::builder()
                .uri("/api/admin/session")
                .header("authorization", format!("Bearer {session}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    for (method, uri, expected) in [
        ("GET", "/api/admin/session", StatusCode::OK),
        ("GET", "/api/admin/articles", StatusCode::OK),
        ("POST", "/api/admin/logout", StatusCode::NO_CONTENT),
        ("GET", "/api/admin/session", StatusCode::UNAUTHORIZED),
        ("GET", "/api/admin/articles", StatusCode::UNAUTHORIZED),
    ] {
        let response = app
            .router
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(uri)
                    .header("authorization", format!("Bearer {session}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), expected);
    }

    let (_, login) = app
        .send(
            "POST",
            "/api/auth/login",
            Some(json!({"username":"jokerbai", "password":"test42"})),
            false,
        )
        .await;
    let db = sqlx::SqlitePool::connect_with(
        sqlx::sqlite::SqliteConnectOptions::new()
            .filename(app.config.data_dir.join("blog.sqlite3")),
    )
    .await
    .unwrap();
    sqlx::query("UPDATE admin_sessions SET expires_at = unixepoch() - 1")
        .execute(&db)
        .await
        .unwrap();
    let response = app
        .router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/admin/session")
                .header(
                    "authorization",
                    format!("Bearer {}", login["token"].as_str().unwrap()),
                )
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn combined_article_submission_commits_files_together_and_rolls_back_failure() {
    async fn submit(app: &App, input: Value, files: &[(&str, &[u8])]) -> (StatusCode, Value) {
        let mut body = Vec::new();
        for (key, content) in files {
            body.extend_from_slice(format!("--upload-boundary\r\nContent-Disposition: form-data; name=\"file-{key}\"; filename=\"homework.txt\"\r\nContent-Type: text/plain\r\n\r\n").as_bytes());
            body.extend_from_slice(content);
            body.extend_from_slice(b"\r\n");
        }
        body.extend_from_slice(b"--upload-boundary--\r\n");
        app.submit(None, input, body).await
    }
    let app = App::new(32).await;
    let a = "00000000-0000-4000-8000-000000000001";
    let b = "00000000-0000-4000-8000-000000000002";
    let mut input = article(true);
    input["content_markdown"] = json!(format!("[作业](attachment:pending-{a})"));
    let (status, saved) = submit(&app, input.clone(), &[(a, b"one"), (b, b"two")]).await;
    assert_eq!(status, StatusCode::CREATED, "{saved}");
    assert_eq!(saved["attachments"].as_array().unwrap().len(), 2);
    assert!(
        !saved["content_markdown"]
            .as_str()
            .unwrap()
            .contains("attachment:pending-")
    );
    assert_eq!(
        app.send("GET", "/api/articles", None, false).await.1["total"],
        1
    );
    let count = std::fs::read_dir(app.config.data_dir.join("uploads"))
        .unwrap()
        .count();
    let (status, _) = submit(&app, input.clone(), &[(a, b"another")]).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(
        std::fs::read_dir(app.config.data_dir.join("uploads"))
            .unwrap()
            .count(),
        count
    );
    input["slug"] = json!("failed-batch");
    let (status, _) = submit(&app, input, &[(a, b"ok"), (b, &[7; 33])]).await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(
        app.send("GET", "/api/admin/articles", None, true).await.1["total"],
        1
    );
    assert_eq!(
        std::fs::read_dir(app.config.data_dir.join("uploads"))
            .unwrap()
            .count(),
        count
    );
}
