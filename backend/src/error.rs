use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::json;

pub struct ApiError(pub StatusCode, pub String);
pub type ApiResult<T> = Result<T, ApiError>;

impl ApiError {
    pub fn bad(message: impl Into<String>) -> Self {
        Self(StatusCode::BAD_REQUEST, message.into())
    }
    pub fn missing() -> Self {
        Self(StatusCode::NOT_FOUND, "内容不存在".into())
    }
    pub fn too_large() -> Self {
        Self(StatusCode::PAYLOAD_TOO_LARGE, "附件超过上传大小限制".into())
    }
    pub fn internal(error: impl std::fmt::Display) -> Self {
        tracing::error!(%error, "Request failed");
        Self(
            StatusCode::INTERNAL_SERVER_ERROR,
            "服务暂时不可用，请稍后重试".into(),
        )
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(error: sqlx::Error) -> Self {
        if let sqlx::Error::Database(ref database) = error
            && database.is_unique_violation()
        {
            return Self(StatusCode::CONFLICT, "文章地址已存在".into());
        }
        Self::internal(error)
    }
}
impl From<std::io::Error> for ApiError {
    fn from(error: std::io::Error) -> Self {
        Self::internal(error)
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({"error": {"message": self.1}}))).into_response()
    }
}
