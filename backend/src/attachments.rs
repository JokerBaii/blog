use crate::{
    AppState,
    error::{ApiError, ApiResult},
    now, valid_id,
};
use axum::{
    body::Body,
    extract::{Path, Request, State},
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
pub(crate) fn multipart_error(error: axum::extract::multipart::MultipartError) -> ApiError {
    if error.status() == StatusCode::PAYLOAD_TOO_LARGE {
        ApiError::too_large()
    } else {
        ApiError::bad("附件表单格式不正确")
    }
}
pub(crate) struct StagedAttachment {
    pub id: String,
    pub filename: String,
    size: usize,
    file: PendingFile,
}
impl StagedAttachment {
    pub async fn commit(
        &mut self,
        state: &AppState,
        article_id: &str,
        transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    ) -> ApiResult<()> {
        self.file.move_to(state.uploads.join(&self.id))?;
        sqlx::query("INSERT INTO attachments (id, article_id, filename, size, created_at) VALUES (?, ?, ?, ?, ?)")
            .bind(&self.id).bind(article_id).bind(&self.filename).bind(self.size as i64).bind(now()).execute(&mut **transaction).await?;
        Ok(())
    }
    pub fn persist(self) {
        self.file.persist();
    }
}

pub(crate) async fn stage_field(
    mut field: axum::extract::multipart::Field<'_>,
    state: &AppState,
) -> ApiResult<StagedAttachment> {
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
    let pending = PendingFile(Some(temporary.clone()));
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
    if size == 0 {
        return Err(ApiError::bad("附件不能为空"));
    }
    file.sync_all().await?;
    drop(file);
    Ok(StagedAttachment {
        id,
        filename,
        size,
        file: pending,
    })
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
    let mut transaction = state.db.begin().await?;
    let row = sqlx::query("SELECT a.id AS article_id, a.content_markdown FROM attachments f JOIN articles a ON a.id = f.article_id WHERE f.id = ?")
        .bind(&id).fetch_optional(&mut *transaction).await?.ok_or_else(ApiError::missing)?;
    let article_id: String = row.try_get("article_id")?;
    let markdown: String = row.try_get("content_markdown")?;
    let cleaned = remove_attachment_links(&markdown, &format!("/api/attachments/{id}/download"));
    sqlx::query(
        "UPDATE articles SET content_markdown = ?, word_count = ?, updated_at = ? WHERE id = ?",
    )
    .bind(&cleaned)
    .bind(crate::models::count_words(&cleaned) as i64)
    .bind(now())
    .bind(article_id)
    .execute(&mut *transaction)
    .await?;
    sqlx::query("DELETE FROM attachments WHERE id = ?")
        .bind(&id)
        .execute(&mut *transaction)
        .await?;
    transaction.commit().await?;
    remove_stored_file(&state, &id).await;
    Ok(StatusCode::NO_CONTENT)
}

fn remove_attachment_links(markdown: &str, href: &str) -> String {
    use pulldown_cmark::{Event, Options, Parser, Tag};
    let matches = |destination: &str| destination.split(['?', '#']).next() == Some(href);
    let parser = Parser::new_ext(
        markdown,
        Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH | Options::ENABLE_TASKLISTS,
    );
    let mut ranges: Vec<_> = parser
        .reference_definitions()
        .iter()
        .filter(|(_, definition)| matches(&definition.dest))
        .map(|(_, definition)| definition.span.clone())
        .collect();
    for (event, range) in parser.into_offset_iter() {
        if let Event::Start(Tag::Link { dest_url, .. } | Tag::Image { dest_url, .. }) = event
            && matches(&dest_url)
        {
            ranges.push(range);
        }
    }
    for range in &mut ranges {
        let start = markdown[..range.start].rfind('\n').map_or(0, |i| i + 1);
        let end = markdown[range.end..]
            .find('\n')
            .map_or(markdown.len(), |i| range.end + i);
        let prefix = markdown[start..range.start].trim();
        let marker = ["-", "+", "*"].contains(&prefix)
            || prefix.strip_suffix(['.', ')']).is_some_and(|number| {
                !number.is_empty() && number.bytes().all(|byte| byte.is_ascii_digit())
            });
        if (prefix.is_empty() || marker) && markdown[range.end..end].trim().is_empty() {
            range.start = start;
            range.end = if end < markdown.len() { end + 1 } else { end };
        }
    }
    ranges.sort_by_key(|range| (range.start, std::cmp::Reverse(range.end)));
    let mut result = String::with_capacity(markdown.len());
    let mut end = 0;
    for range in ranges {
        if range.start > end {
            result.push_str(&markdown[end..range.start]);
        }
        end = end.max(range.end);
    }
    result.push_str(&markdown[end..]);
    result
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
