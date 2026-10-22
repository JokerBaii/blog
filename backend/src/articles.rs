use crate::{
    AppState,
    error::{ApiError, ApiResult},
    models::*,
    now, valid_id,
};
use axum::{
    Json,
    extract::{Path, Query, State, rejection::JsonRejection},
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
    let clause = "WHERE (? OR published = 1) AND (? = '' OR category = ?) AND (? = '' OR instr(lower(title || ' ' || description || ' ' || tags), lower(?)) > 0)";
    let count_sql = format!("SELECT COUNT(*) FROM articles {clause}");
    let total: i64 = sqlx::query_scalar(&count_sql)
        .bind(admin)
        .bind(&category)
        .bind(&category)
        .bind(&q)
        .bind(&q)
        .fetch_one(&state.db)
        .await?;
    let select = format!(
        "SELECT id, slug, title, description, tags, category, published, created_at, updated_at, published_at, content_markdown FROM articles {clause} ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?"
    );
    let rows = sqlx::query(&select)
        .bind(admin)
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
    let row = sqlx::query("SELECT * FROM articles WHERE slug = ? AND published = 1")
        .bind(slug)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(ApiError::missing)?;
    detail(&state, row).await.map(Json)
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
        content_html: markdown_html(&content_markdown),
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
    body: Result<Json<ArticleInput>, JsonRejection>,
) -> ApiResult<(StatusCode, Json<ArticleDetail>)> {
    let input = body
        .map_err(|_| ApiError::bad("请求 JSON 格式不正确"))?
        .0
        .validate()?;
    let id = uuid::Uuid::new_v4().to_string();
    let timestamp = now();
    sqlx::query("INSERT INTO articles (id, slug, title, description, content_markdown, tags, category, published, created_at, updated_at, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(&id).bind(&input.slug).bind(&input.title).bind(&input.description).bind(&input.content_markdown)
        .bind(serde_json::to_string(&input.tags).map_err(ApiError::internal)?).bind(&input.category).bind(input.published)
        .bind(&timestamp).bind(&timestamp).bind(if input.published { Some(&timestamp) } else { None }).execute(&state.db).await?;
    Ok((
        StatusCode::CREATED,
        admin_detail(State(state), Path(id)).await?,
    ))
}
pub async fn update(
    State(state): State<AppState>,
    Path(id): Path<String>,
    body: Result<Json<ArticleInput>, JsonRejection>,
) -> ApiResult<Json<ArticleDetail>> {
    valid_id(&id)?;
    let input = body
        .map_err(|_| ApiError::bad("请求 JSON 格式不正确"))?
        .0
        .validate()?;
    let timestamp = now();
    let result = sqlx::query("UPDATE articles SET slug = ?, title = ?, description = ?, content_markdown = ?, tags = ?, category = ?, published = ?, updated_at = ?, published_at = CASE WHEN ? THEN COALESCE(published_at, ?) ELSE published_at END WHERE id = ?")
        .bind(&input.slug).bind(&input.title).bind(&input.description).bind(&input.content_markdown)
        .bind(serde_json::to_string(&input.tags).map_err(ApiError::internal)?).bind(&input.category).bind(input.published)
        .bind(&timestamp).bind(input.published).bind(&timestamp).bind(&id).execute(&state.db).await?;
    if result.rows_affected() == 0 {
        return Err(ApiError::missing());
    }
    admin_detail(State(state), Path(id)).await
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
    body: Result<Json<PreviewInput>, JsonRejection>,
) -> ApiResult<Json<serde_json::Value>> {
    let input = body.map_err(|_| ApiError::bad("请求 JSON 格式不正确"))?.0;
    if input.content_markdown.len() > 1_000_000 {
        return Err(ApiError::bad("正文不能超过 1 MB"));
    }
    Ok(Json(
        serde_json::json!({"content_html": markdown_html(&input.content_markdown)}),
    ))
}
