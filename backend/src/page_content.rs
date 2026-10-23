use crate::{
    AppState,
    error::{ApiError, ApiResult},
};
use axum::{Json, extract::State};
use serde_json::Value;

fn defaults() -> Value {
    serde_json::from_str(include_str!(
        "../../src/core/data/page-content-defaults.json"
    ))
    .expect("page content defaults must be valid JSON")
}

fn valid(value: &Value, template: &Value, field: &str) -> bool {
    match (value, template) {
        (Value::Object(value), Value::Object(template)) => {
            value.len() == template.len()
                && template
                    .iter()
                    .all(|(key, example)| value.get(key).is_some_and(|v| valid(v, example, key)))
        }
        (Value::Array(value), Value::Array(_)) if field == "links" => {
            value.len() <= 50 && {
                let mut ids = std::collections::HashSet::new();
                value.iter().all(|item| {
                    valid_link(item) && ids.insert(item["id"].as_str().unwrap_or_default())
                })
            }
        }
        (Value::Array(value), Value::Array(template)) => {
            value.len() == template.len()
                && value.iter().zip(template).all(|(v, t)| valid(v, t, field))
        }
        (Value::String(value), Value::String(template)) => {
            if ["id", "key", "line"].contains(&field) {
                return value == template;
            }
            if value.chars().count() > 4000 || value.contains('\0') {
                return false;
            }
            if ["displayName", "siteName", "name", "title"].contains(&field)
                && value.trim().is_empty()
            {
                return false;
            }
            if field == "loveSince" {
                return value.is_empty()
                    || chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").is_ok();
            }
            if ["image", "sticker", "github"].contains(&field) && !value.is_empty() {
                return (value.starts_with('/') && !value.starts_with("//"))
                    || value.starts_with("https://");
            }
            true
        }
        _ => false,
    }
}

fn valid_link(value: &Value) -> bool {
    let Some(item) = value.as_object() else {
        return false;
    };
    let keys = [
        "id",
        "name",
        "href",
        "domain",
        "category",
        "description",
        "color",
        "wash",
        "line",
        "art",
    ];
    item.len() == keys.len()
        && keys.iter().all(|key| {
            let Some(value) = item.get(*key).and_then(Value::as_str) else {
                return false;
            };
            if value.len() > 4000 || value.contains('\0') {
                return false;
            }
            match *key {
                "id" => {
                    !value.is_empty()
                        && value.len() <= 80
                        && value
                            .bytes()
                            .all(|c| c.is_ascii_alphanumeric() || c == b'-')
                }
                "name" | "domain" => !value.trim().is_empty(),
                "href" => value
                    .parse::<axum::http::Uri>()
                    .is_ok_and(|uri| uri.scheme_str() == Some("https") && uri.host().is_some()),
                "art" => {
                    (value.starts_with('/') && !value.starts_with("//"))
                        || value.starts_with("https://")
                }
                "color" | "wash" | "line" => {
                    value.len() == 7
                        && value.starts_with('#')
                        && value[1..].bytes().all(|c| c.is_ascii_hexdigit())
                }
                _ => true,
            }
        })
}

pub async fn get(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let saved: Option<String> = sqlx::query_scalar("SELECT content FROM page_content WHERE id = 1")
        .fetch_optional(&state.db)
        .await?;
    Ok(Json(match saved {
        Some(content) => serde_json::from_str(&content).map_err(ApiError::internal)?,
        None => defaults(),
    }))
}

pub async fn save(
    State(state): State<AppState>,
    Json(content): Json<Value>,
) -> ApiResult<Json<Value>> {
    if !valid(&content, &defaults(), "") {
        return Err(ApiError::bad(
            "页面内容格式不正确；标题不能为空，图片和 GitHub 请使用 HTTPS 或站内地址。",
        ));
    }
    sqlx::query("INSERT INTO page_content(id, content) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET content = excluded.content")
        .bind(content.to_string()).execute(&state.db).await?;
    Ok(Json(content))
}
