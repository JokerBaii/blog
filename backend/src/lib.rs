mod articles;
mod attachments;
mod auth;
mod config;
pub mod error;
mod models;

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
        Ok(Self {
            db,
            uploads: Arc::new(uploads),
            token_hash: Sha256::digest(config.admin_token.as_bytes()).into(),
            config: Arc::new(config),
        })
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
    let upload = post(attachments::upload)
        .layer::<_, std::convert::Infallible>(DefaultBodyLimit::max(
            state.config.max_upload_bytes + 65536,
        ))
        .layer(tower_http::limit::RequestBodyLimitLayer::new(
            state.config.max_upload_bytes + 65536,
        ));
    let admin = Router::new()
        .route(
            "/articles",
            get(articles::admin_list).post(articles::create),
        )
        .route(
            "/articles/{id}",
            get(articles::admin_detail)
                .put(articles::update)
                .delete(articles::delete),
        )
        .route("/articles/{id}/attachments", upload)
        .route(
            "/attachments/{id}",
            axum::routing::delete(attachments::delete),
        )
        .route(
            "/attachments/{id}/download",
            get(attachments::admin_download),
        )
        .route("/preview", post(articles::preview))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            auth::require_admin,
        ));
    let api = Router::new()
        .route("/health", get(health))
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
