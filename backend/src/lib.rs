mod account;
mod articles;
mod attachments;
mod auth;
mod avatar;
mod config;
pub mod error;
mod migrations;
mod models;
mod page_content;

use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, State},
    http::{HeaderValue, header},
    middleware,
    routing::{get, post},
};
pub use config::Config;
use sha2::{Digest, Sha256};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use std::{path::PathBuf, sync::Arc, time::Duration};
use tower_http::{set_header::SetResponseHeaderLayer, trace::TraceLayer};

#[derive(Clone)]
pub struct AppState {
    pub(crate) db: sqlx::SqlitePool,
    pub(crate) uploads: Arc<PathBuf>,
    pub(crate) token_hash: [u8; 32],
    pub(crate) config: Arc<Config>,
    render_slots: Arc<tokio::sync::Semaphore>,
}

impl AppState {
    pub async fn open(config: Config) -> Result<Self, Box<dyn std::error::Error>> {
        config.validate()?;
        tokio::fs::create_dir_all(&config.data_dir).await?;
        let uploads = config.data_dir.join("uploads");
        tokio::fs::create_dir_all(&uploads).await?;
        let db = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(config.data_dir.join("blog.sqlite3"))
                    .create_if_missing(true)
                    .foreign_keys(true)
                    .journal_mode(SqliteJournalMode::Wal)
                    .busy_timeout(Duration::from_secs(5)),
            )
            .await?;
        sqlx::raw_sql(include_str!("schema.sql"))
            .execute(&db)
            .await?;
        migrations::word_counts(&db).await?;
        Ok(Self {
            db,
            uploads: Arc::new(uploads),
            token_hash: Sha256::digest(config.admin_token.as_bytes()).into(),
            config: Arc::new(config),
            render_slots: Arc::new(tokio::sync::Semaphore::new(
                std::thread::available_parallelism()
                    .map_or(1, usize::from)
                    .min(4),
            )),
        })
    }

    pub(crate) async fn render_markdown(
        &self,
        markdown: String,
        preview: bool,
    ) -> error::ApiResult<String> {
        let permit = self
            .render_slots
            .clone()
            .acquire_owned()
            .await
            .map_err(error::ApiError::internal)?;
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            if preview {
                models::markdown_preview_html(&markdown)
            } else {
                models::markdown_html(&markdown)
            }
        })
        .await
        .map_err(error::ApiError::internal)
    }
}

async fn health(State(state): State<AppState>) -> Result<Json<serde_json::Value>, error::ApiError> {
    sqlx::query("SELECT 1").execute(&state.db).await?;
    Ok(Json(
        serde_json::json!({"status": "ok", "max_upload_bytes": state.config.max_upload_bytes}),
    ))
}
async fn not_found() -> error::ApiError {
    error::ApiError::missing()
}

pub fn router(state: AppState) -> Router {
    let admin = Router::new()
        .route(
            "/articles",
            get(articles::admin_list)
                .post(articles::create)
                .layer::<_, std::convert::Infallible>(DefaultBodyLimit::max(
                    state.config.max_upload_bytes + 2_097_152,
                ))
                .layer(tower_http::limit::RequestBodyLimitLayer::new(
                    state.config.max_upload_bytes + 2_097_152,
                )),
        )
        .route(
            "/articles/{id}",
            get(articles::admin_detail)
                .put(articles::update)
                .delete(articles::delete)
                .layer::<_, std::convert::Infallible>(DefaultBodyLimit::max(
                    state.config.max_upload_bytes + 2_097_152,
                ))
                .layer(tower_http::limit::RequestBodyLimitLayer::new(
                    state.config.max_upload_bytes + 2_097_152,
                )),
        )
        .route(
            "/articles/by-slug/{slug}",
            get(articles::admin_detail_by_slug),
        )
        .route(
            "/attachments/{id}",
            axum::routing::delete(attachments::delete),
        )
        .route(
            "/attachments/{id}/download",
            get(attachments::admin_download),
        )
        .route(
            "/avatar",
            post(avatar::upload)
                .layer::<_, std::convert::Infallible>(DefaultBodyLimit::max(2 * 1024 * 1024))
                .layer(tower_http::limit::RequestBodyLimitLayer::new(
                    2 * 1024 * 1024,
                )),
        )
        .route("/account", post(account::create))
        .route(
            "/page-content",
            get(page_content::get)
                .put(page_content::save)
                .layer::<_, std::convert::Infallible>(DefaultBodyLimit::max(65536)),
        )
        .route("/logout", post(account::logout))
        .route("/session", get(account::session))
        .route("/preview", post(articles::preview))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            auth::require_admin,
        ));
    let api = Router::new()
        .route("/health", get(health))
        .route(
            "/auth/login",
            post(account::login).layer::<_, std::convert::Infallible>(DefaultBodyLimit::max(4096)),
        )
        .route("/avatar", get(avatar::get))
        .route("/page-content", get(page_content::get))
        .route("/articles", get(articles::public_list))
        .route("/articles/{slug}", get(articles::public_detail))
        .route(
            "/attachments/{id}/download",
            get(attachments::public_download),
        )
        .nest("/admin", admin)
        .fallback(not_found)
        .layer(DefaultBodyLimit::max(2 * 1024 * 1024))
        .layer(SetResponseHeaderLayer::overriding(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-store"),
        ));
    Router::new()
        .route("/api", get(not_found))
        .nest("/api", api)
        .fallback(not_found)
        .layer(SetResponseHeaderLayer::if_not_present(
            header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

pub(crate) fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
pub(crate) fn valid_id(id: &str) -> Result<(), error::ApiError> {
    // File storage keys are canonical UUIDs, never user-provided paths.
    match uuid::Uuid::parse_str(id) {
        Ok(uuid) if uuid.to_string() == id => Ok(()),
        _ => Err(error::ApiError::missing()),
    }
}
