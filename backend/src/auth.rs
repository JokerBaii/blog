use crate::{AppState, error::ApiError};
use axum::{
    extract::{Request, State},
    http::{StatusCode, header},
    middleware::Next,
    response::Response,
};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

pub async fn require_admin(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Result<Response, ApiError> {
    let token = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "))
        .filter(|s| s.len() <= 512);
    let valid = token
        .map(|token| {
            let digest: [u8; 32] = Sha256::digest(token.as_bytes()).into();
            bool::from(digest.ct_eq(&state.token_hash))
        })
        .unwrap_or(false);
    if !valid {
        return Err(ApiError(StatusCode::UNAUTHORIZED, "管理员令牌无效".into()));
    }
    Ok(next.run(request).await)
}
