use crate::{
    AppState,
    error::{ApiError, ApiResult},
};
use axum::{
    Json,
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

fn image_type(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() >= 24 && bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.len() >= 4 && bytes.starts_with(b"\xff\xd8\xff") && bytes.ends_with(b"\xff\xd9")
    {
        Some("image/jpeg")
    } else if bytes.len() >= 20 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

pub async fn upload(State(state): State<AppState>, bytes: Bytes) -> ApiResult<Json<Value>> {
    if bytes.len() > 2 * 1024 * 1024 {
        return Err(ApiError::too_large());
    }
    let content_type = image_type(&bytes)
        .ok_or_else(|| ApiError::bad("请选择 PNG、JPG 或 WebP 图片，大小不超过 2 MB"))?;
    sqlx::query("INSERT INTO site_assets (name, data, content_type) VALUES ('avatar', ?, ?) ON CONFLICT(name) DO UPDATE SET data = excluded.data, content_type = excluded.content_type")
        .bind(&bytes[..]).bind(content_type).execute(&state.db).await?;
    Ok(Json(json!({"avatar_url": "/api/avatar"})))
}

pub async fn get(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Response> {
    let (bytes, content_type): (Vec<u8>, String) =
        sqlx::query_as("SELECT data, content_type FROM site_assets WHERE name = 'avatar'")
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(ApiError::missing)?;
    let etag = format!("\"{:x}\"", Sha256::digest(&bytes));
    let mut response =
        if headers.get("if-none-match").and_then(|v| v.to_str().ok()) == Some(etag.as_str()) {
            StatusCode::NOT_MODIFIED.into_response()
        } else {
            ([("content-type", content_type)], bytes).into_response()
        };
    response
        .headers_mut()
        .insert("cache-control", "public, no-cache".parse().unwrap());
    response
        .headers_mut()
        .insert("x-content-type-options", "nosniff".parse().unwrap());
    response.headers_mut().insert("etag", etag.parse().unwrap());
    Ok(response)
}
