use crate::{
    AppState,
    error::{ApiError, ApiResult},
    models::*,
    now, valid_id,
};
use axum::{
    Json,
    extract::{FromRequest, Multipart, Path, Query, Request, State, rejection::JsonRejection},
    http::StatusCode,
};
use serde::Deserialize;
use sqlx::Row;

pub async fn public_list(
    State(state): State<AppState>,
    Query(query): Query<ListQuery>,
) -> ApiResult<Json<ArticleList>> {
    list(&state, query, false).await.map(Json)
}
pub async fn admin_list(
    State(state): State<AppState>,
    Query(query): Query<ListQuery>,
) -> ApiResult<Json<ArticleList>> {
    list(&state, query, true).await.map(Json)
}
async fn list(state: &AppState, query: ListQuery, admin: bool) -> ApiResult<ArticleList> {
    let page = query.page.unwrap_or(1);
    let per_page = query.per_page.unwrap_or(20);
    let q = query.q.unwrap_or_default();
    let category = query.category.unwrap_or_default();
    if page == 0
        || !(1..=100).contains(&per_page)
        || q.chars().count() > 200
        || (!category.is_empty() && !["tech", "anime", "life"].contains(&category.as_str()))
    {
        return Err(ApiError::bad("分页、关键词或分类参数无效"));
    }
    // instr gives literal substring search: user input never becomes SQL or a LIKE pattern.
    let visibility = if admin { "" } else { "published = 1 AND " };
    let clause = format!(
        "WHERE {visibility}(? = '' OR category = ?) AND (? = '' OR instr(lower(title || ' ' || description || ' ' || tags), lower(?)) > 0)"
    );
    let count_sql = format!("SELECT COUNT(*) FROM articles {clause}");
    let total: i64 = sqlx::query_scalar(&count_sql)
        .bind(&category)
        .bind(&category)
        .bind(&q)
        .bind(&q)
        .fetch_one(&state.db)
        .await?;
    let select = format!(
        "SELECT id, slug, title, description, tags, category, published, created_at, updated_at, published_at, word_count FROM articles {clause} ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?"
    );
    let rows = sqlx::query(&select)
        .bind(&category)
        .bind(&category)
        .bind(&q)
        .bind(&q)
        .bind(i64::from(per_page))
        .bind(i64::from(page - 1) * i64::from(per_page))
        .fetch_all(&state.db)
        .await?;
    let items = rows
        .iter()
        .map(ArticleSummary::from_row)
        .collect::<ApiResult<Vec<_>>>()?;
    Ok(ArticleList {
        items,
        total,
        page,
        per_page,
    })
}

pub async fn public_detail(
    State(state): State<AppState>,
    Path(slug): Path<String>,
) -> ApiResult<Json<ArticleDetail>> {
    detail_by_slug(&state, slug, false).await
}
pub async fn admin_detail_by_slug(
    State(state): State<AppState>,
    Path(slug): Path<String>,
) -> ApiResult<Json<ArticleDetail>> {
    validate_slug(&slug)?;
    detail_by_slug(&state, slug, true).await
}
async fn detail_by_slug(
    state: &AppState,
    slug: String,
    admin: bool,
) -> ApiResult<Json<ArticleDetail>> {
    let row = sqlx::query("SELECT * FROM articles WHERE slug = ? AND (? OR published = 1)")
        .bind(slug)
        .bind(admin)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(ApiError::missing)?;
    detail(state, row).await.map(Json)
}
pub async fn admin_detail(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> ApiResult<Json<ArticleDetail>> {
    valid_id(&id)?;
    let row = sqlx::query("SELECT * FROM articles WHERE id = ?")
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(ApiError::missing)?;
    detail(&state, row).await.map(Json)
}
async fn detail(state: &AppState, row: sqlx::sqlite::SqliteRow) -> ApiResult<ArticleDetail> {
    let summary = ArticleSummary::from_row(&row)?;
    let content_markdown: String = row.try_get("content_markdown")?;
    let rows =
        sqlx::query("SELECT * FROM attachments WHERE article_id = ? ORDER BY created_at, id")
            .bind(&summary.id)
            .fetch_all(&state.db)
            .await?;
    Ok(ArticleDetail {
        content_html: state
            .render_markdown(content_markdown.clone(), false)
            .await?,
        content_markdown,
        summary,
        attachments: rows
            .iter()
            .map(Attachment::from_row)
            .collect::<ApiResult<_>>()?,
    })
}
pub async fn create(
    State(state): State<AppState>,
    request: Request,
) -> ApiResult<(StatusCode, Json<ArticleDetail>)> {
    let (input, files) = read_submission(request, &state).await?;
    Ok((
        StatusCode::CREATED,
        Json(persist_submission(state, None, input, files).await?),
    ))
}
pub async fn update(
    State(state): State<AppState>,
    Path(id): Path<String>,
    request: Request,
) -> ApiResult<Json<ArticleDetail>> {
    valid_id(&id)?;
    let (input, files) = read_submission(request, &state).await?;
    Ok(Json(
        persist_submission(state, Some(id), input, files).await?,
    ))
}
type SubmissionFiles = Vec<(String, crate::attachments::StagedAttachment)>;
async fn read_submission(
    request: Request,
    state: &AppState,
) -> ApiResult<(ArticleInput, SubmissionFiles)> {
    if !request
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.starts_with("multipart/form-data"))
    {
        return Ok((
            Json::<ArticleInput>::from_request(request, state)
                .await
                .map_err(|_| ApiError::bad("请求 JSON 格式不正确"))?
                .0,
            vec![],
        ));
    }
    let mut multipart = Multipart::from_request(request, state)
        .await
        .map_err(|_| ApiError::bad("附件表单格式不正确"))?;
    let mut input = None;
    let mut files = Vec::new();
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(crate::attachments::multipart_error)?
    {
        let name = field.name().unwrap_or_default().to_owned();
        if name == "article" && input.is_none() {
            let bytes = field
                .bytes()
                .await
                .map_err(crate::attachments::multipart_error)?;
            if bytes.len() > 2_097_152 {
                return Err(ApiError::bad("文章数据过大"));
            }
            input = Some(
                serde_json::from_slice(&bytes).map_err(|_| ApiError::bad("文章数据格式不正确"))?,
            );
        } else if let Some(key) = name.strip_prefix("file-") {
            valid_id(key).map_err(|_| ApiError::bad("附件标识无效"))?;
            if files.iter().any(|(other, _)| other == key) {
                return Err(ApiError::bad("附件标识重复"));
            }
            let staged = crate::attachments::stage_field(field, state).await?;
            files.push((key.to_owned(), staged));
        } else {
            return Err(ApiError::bad("附件表单字段不正确"));
        }
    }
    Ok((input.ok_or_else(|| ApiError::bad("缺少文章数据"))?, files))
}
async fn persist_submission(
    state: AppState,
    existing_id: Option<String>,
    mut input: ArticleInput,
    files: SubmissionFiles,
) -> ApiResult<ArticleDetail> {
    // The single transaction commits the article, publication state and all attachments together.
    tokio::spawn(async move {
        let mut transaction = state.db.begin().await?;
        if let Some(id) = &existing_id {
            let slug: String = sqlx::query_scalar("SELECT slug FROM articles WHERE id = ?").bind(id).fetch_optional(&mut *transaction).await?.ok_or_else(ApiError::missing)?;
            if input.slug.trim().is_empty() { input.slug = slug; }
        } else if input.slug.trim().is_empty() { input.slug = format!("note-{}", uuid::Uuid::new_v4().simple()); }
        for (key, file) in &files {
            input.content_markdown = input.content_markdown.replace(&format!("attachment:pending-{key}"), &format!("/api/attachments/{}/download", file.id));
        }
        if input.content_markdown.trim().is_empty() && !files.is_empty() {
            input.content_markdown = files.iter().map(|(_, file)| format!("- [{}](/api/attachments/{}/download)", file.filename.replace('\\', "\\\\").replace('[', "\\[").replace(']', "\\]"), file.id)).collect::<Vec<_>>().join("\n");
        }
        if input.content_markdown.contains("attachment:pending-") { return Err(ApiError::bad("正文中有未提交的附件，请重新添加或移除对应链接")); }
        let input = input.validate()?;
        let id = existing_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let timestamp = now();
        sqlx::query("INSERT INTO articles (id, slug, title, description, content_markdown, word_count, tags, category, published, created_at, updated_at, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET slug=excluded.slug, title=excluded.title, description=excluded.description, content_markdown=excluded.content_markdown, word_count=excluded.word_count, tags=excluded.tags, category=excluded.category, published=excluded.published, updated_at=excluded.updated_at, published_at=CASE WHEN excluded.published THEN COALESCE(articles.published_at, excluded.published_at) ELSE articles.published_at END")
            .bind(&id).bind(&input.slug).bind(&input.title).bind(&input.description).bind(&input.content_markdown)
            .bind(count_words(&input.content_markdown) as i64)
            .bind(serde_json::to_string(&input.tags).map_err(ApiError::internal)?).bind(&input.category).bind(input.published)
            .bind(&timestamp).bind(&timestamp).bind(if input.published { Some(&timestamp) } else { None }).execute(&mut *transaction).await?;
        let mut files = files;
        for (_, file) in &mut files { file.commit(&state, &id, &mut transaction).await?; }
        transaction.commit().await?;
        for (_, file) in files { file.finish(id.clone()); }
        Ok(admin_detail(State(state), Path(id)).await?.0)
    }).await.map_err(ApiError::internal)?
}
pub async fn delete(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> ApiResult<StatusCode> {
    valid_id(&id)?;
    let mut transaction = state.db.begin().await?;
    let attachment_ids: Vec<String> =
        sqlx::query_scalar("SELECT id FROM attachments WHERE article_id = ?")
            .bind(&id)
            .fetch_all(&mut *transaction)
            .await?;
    let result = sqlx::query("DELETE FROM articles WHERE id = ?")
        .bind(&id)
        .execute(&mut *transaction)
        .await?;
    if result.rows_affected() == 0 {
        return Err(ApiError::missing());
    }
    transaction.commit().await?;
    for id in attachment_ids {
        crate::attachments::remove_stored_file(&state, &id).await;
    }
    Ok(StatusCode::NO_CONTENT)
}
#[derive(Deserialize)]
pub struct PreviewInput {
    content_markdown: String,
}
pub async fn preview(
    State(state): State<AppState>,
    body: Result<Json<PreviewInput>, JsonRejection>,
) -> ApiResult<Json<serde_json::Value>> {
    let input = body.map_err(|_| ApiError::bad("请求 JSON 格式不正确"))?.0;
    if input.content_markdown.len() > 1_000_000 {
        return Err(ApiError::bad("正文不能超过 1 MB"));
    }
    let content_html = state.render_markdown(input.content_markdown, true).await?;
    Ok(Json(serde_json::json!({"content_html": content_html})))
}
