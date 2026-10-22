use crate::{
    AppState,
    error::{ApiError, ApiResult},
    models::Attachment,
    now, valid_id,
};
use axum::{
    Json,
    body::Body,
    extract::{Multipart, Path, Request, State},
    http::{HeaderValue, StatusCode, header},
    response::Response,
};
use sqlx::Row;
use tokio::io::AsyncWriteExt;
use tower::ServiceExt;
use tower_http::services::ServeFile;

// A canceled or failed upload must never leave a partial file on disk.
struct PendingFile(Option<std::path::PathBuf>);
impl PendingFile {
    fn move_to(&mut self, path: std::path::PathBuf) -> std::io::Result<()> {
        std::fs::rename(self.0.as_ref().expect("pending upload path"), &path)?;
        self.0 = Some(path);
        Ok(())
    }
    fn persist(mut self) {
        let _ = self.0.take();
    }
}
impl Drop for PendingFile {
    fn drop(&mut self) {
        if let Some(path) = &self.0 {
            let _ = std::fs::remove_file(path);
        }
    }
}
fn multipart_error(error: axum::extract::multipart::MultipartError) -> ApiError {
    if error.status() == StatusCode::PAYLOAD_TOO_LARGE {
        ApiError::too_large()
    } else {
        ApiError::bad("附件表单格式不正确")
    }
}
pub async fn upload(
    State(state): State<AppState>,
    Path(article_id): Path<String>,
    mut multipart: Multipart,
) -> ApiResult<(StatusCode, Json<Attachment>)> {
    valid_id(&article_id)?;
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM articles WHERE id = ?)")
        .bind(&article_id)
        .fetch_one(&state.db)
        .await?;
    if !exists {
        return Err(ApiError::missing());
    }
    let mut field = multipart
        .next_field()
        .await
        .map_err(multipart_error)?
        .ok_or_else(|| ApiError::bad("请选择附件"))?;
    if field.name() != Some("file") {
        return Err(ApiError::bad("附件字段名必须为 file"));
    }
    let original = field
        .file_name()
        .ok_or_else(|| ApiError::bad("附件缺少文件名"))?;
    let filename = original
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or_default()
        .trim()
        .to_owned();
    if filename.is_empty()
        || filename.len() > 255
        || filename == "."
        || filename == ".."
        || filename.chars().any(char::is_control)
    {
        return Err(ApiError::bad("附件文件名无效或过长"));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let temporary = state.uploads.join(format!("{id}.part"));
    let file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)?;
    let mut pending = PendingFile(Some(temporary.clone()));
    let mut file = tokio::fs::File::from_std(file);
    let mut size = 0usize;
    while let Some(chunk) = field.chunk().await.map_err(multipart_error)? {
        size = size
            .checked_add(chunk.len())
            .ok_or_else(ApiError::too_large)?;
        if size > state.config.max_upload_bytes {
            return Err(ApiError::too_large());
        }
        file.write_all(&chunk).await?;
    }
    drop(field);
    if size == 0 {
        return Err(ApiError::bad("附件不能为空"));
    }
    file.sync_all().await?;
    drop(file);
    if multipart
        .next_field()
        .await
        .map_err(multipart_error)?
        .is_some()
    {
        return Err(ApiError::bad("每次只能上传一个附件"));
    }
    // Finish the file/DB commit even if the client disconnects at this point.
    tokio::spawn(async move {
        let final_path = state.uploads.join(&id);
        pending.move_to(final_path)?;
        let timestamp = now();
        let result = sqlx::query("INSERT INTO attachments (id, article_id, filename, size, created_at) VALUES (?, ?, ?, ?, ?)")
            .bind(&id).bind(&article_id).bind(&filename).bind(size as i64).bind(&timestamp).execute(&state.db).await;
        if let Err(error) = result {
            if let sqlx::Error::Database(ref database) = error
                && database.is_foreign_key_violation() {
                return Err(ApiError::missing());
            }
            return Err(error.into());
        }
        pending.persist();
        Ok((StatusCode::CREATED, Json(Attachment { download_url: format!("/api/attachments/{id}/download"), id, article_id, filename, size: size as i64, created_at: timestamp })))
    }).await.map_err(ApiError::internal)?
}
pub async fn public_download(
    State(state): State<AppState>,
    Path(id): Path<String>,
    request: Request,
) -> ApiResult<Response> {
    download(state, id, request, false).await
}
pub async fn admin_download(
    State(state): State<AppState>,
    Path(id): Path<String>,
    request: Request,
) -> ApiResult<Response> {
    download(state, id, request, true).await
}
async fn download(
    state: AppState,
    id: String,
    request: Request,
    admin: bool,
) -> ApiResult<Response> {
    valid_id(&id)?;
    let row = sqlx::query("SELECT f.* FROM attachments f JOIN articles a ON a.id = f.article_id WHERE f.id = ? AND (? OR a.published = 1)")
        .bind(&id).bind(admin).fetch_optional(&state.db).await?.ok_or_else(ApiError::missing)?;
    let filename: String = row.try_get("filename")?;
    let path = state.uploads.join(&id);
    if !tokio::fs::try_exists(&path).await? {
        return Err(ApiError::missing());
    }
    let mut response = ServeFile::new(path)
        .oneshot(request)
        .await
        .map_err(ApiError::internal)?
        .map(Body::new);
    let encoded =
        percent_encoding::utf8_percent_encode(&filename, percent_encoding::NON_ALPHANUMERIC);
    let disposition = HeaderValue::from_str(&format!(
        "attachment; filename=\"download\"; filename*=UTF-8''{encoded}"
    ))
    .map_err(ApiError::internal)?;
    response
        .headers_mut()
        .insert(header::CONTENT_DISPOSITION, disposition);
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/octet-stream"),
    );
    Ok(response)
}
pub async fn delete(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> ApiResult<StatusCode> {
    valid_id(&id)?;
    let result = sqlx::query("DELETE FROM attachments WHERE id = ?")
        .bind(&id)
        .execute(&state.db)
        .await?;
    if result.rows_affected() == 0 {
        return Err(ApiError::missing());
    }
    remove_stored_file(&state, &id).await;
    Ok(StatusCode::NO_CONTENT)
}
pub(crate) async fn remove_stored_file(state: &AppState, id: &str) {
    if valid_id(id).is_err() {
        return;
    }
    if let Err(error) = tokio::fs::remove_file(state.uploads.join(id)).await
        && error.kind() != std::io::ErrorKind::NotFound
    {
        tracing::warn!(%error, %id, "Could not remove orphan attachment file");
    }
}
