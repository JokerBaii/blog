use crate::{
    AppState,
    error::{ApiError, ApiResult},
};
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier, password_hash::SaltString};
use axum::{
    Json,
    extract::State,
    http::{HeaderMap, StatusCode},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Credentials {
    username: String,
    password: String,
}

fn valid_credentials(credentials: &Credentials) -> bool {
    (3..=40).contains(&credentials.username.len())
        && credentials
            .username
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
        && (6..=128).contains(&credentials.password.len())
}

pub async fn create(
    State(state): State<AppState>,
    Json(credentials): Json<Credentials>,
) -> ApiResult<Json<Value>> {
    if !valid_credentials(&credentials) {
        return Err(ApiError::bad(
            "用户名需为 3–40 位英文、数字、下划线或连字符，密码需为 6–128 字节",
        ));
    }
    let username = credentials.username;
    let hash = tokio::task::spawn_blocking(move || {
        let salt =
            SaltString::encode_b64(uuid::Uuid::new_v4().as_bytes()).map_err(ApiError::internal)?;
        Argon2::default()
            .hash_password(credentials.password.as_bytes(), &salt)
            .map(|hash| hash.to_string())
            .map_err(ApiError::internal)
    })
    .await
    .map_err(ApiError::internal)??;
    let result = sqlx::query(
        "INSERT OR IGNORE INTO admin_account(id, username, password_hash) VALUES (1, ?, ?)",
    )
    .bind(&username)
    .bind(hash)
    .execute(&state.db)
    .await?;
    if result.rows_affected() == 0 {
        return Err(ApiError(StatusCode::CONFLICT, "管理员账号已存在".into()));
    }
    Ok(Json(json!({"username": username})))
}

pub async fn login(
    State(state): State<AppState>,
    Json(credentials): Json<Credentials>,
) -> ApiResult<Json<Value>> {
    if !valid_credentials(&credentials) {
        return Err(ApiError(
            StatusCode::UNAUTHORIZED,
            "账号或密码不正确".into(),
        ));
    }
    // Reserve a slot atomically before running the password hash (ten attempts per minute).
    let attempts: i64 = sqlx::query_scalar("INSERT INTO login_limit(id, started_at, attempts) VALUES (1, unixepoch(), 1) ON CONFLICT(id) DO UPDATE SET attempts = CASE WHEN started_at <= unixepoch() - 60 THEN 1 ELSE attempts + 1 END, started_at = CASE WHEN started_at <= unixepoch() - 60 THEN unixepoch() ELSE started_at END RETURNING attempts")
        .fetch_one(&state.db).await?;
    if attempts > 10 {
        return Err(ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "尝试次数较多，请一分钟后再登录".into(),
        ));
    }
    let account: Option<(String, String)> =
        sqlx::query_as("SELECT username, password_hash FROM admin_account WHERE id = 1")
            .fetch_optional(&state.db)
            .await?;
    let valid = tokio::task::spawn_blocking(move || {
        if let Some((username, hash)) = account {
            PasswordHash::new(&hash).ok().is_some_and(|hash| {
                Argon2::default()
                    .verify_password(credentials.password.as_bytes(), &hash)
                    .is_ok()
            }) && username == credentials.username
        } else {
            // Equal-cost failure before an account has been initialized.
            if let Ok(salt) = SaltString::encode_b64(uuid::Uuid::new_v4().as_bytes()) {
                let _ = Argon2::default().hash_password(credentials.password.as_bytes(), &salt);
            }
            false
        }
    })
    .await
    .map_err(ApiError::internal)?;
    if !valid {
        return Err(ApiError(
            StatusCode::UNAUTHORIZED,
            "账号或密码不正确".into(),
        ));
    }
    let token = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let hash = format!("{:x}", Sha256::digest(token.as_bytes()));
    let mut transaction = state.db.begin().await?;
    sqlx::query("DELETE FROM admin_sessions WHERE expires_at <= unixepoch()")
        .execute(&mut *transaction)
        .await?;
    sqlx::query(
        "INSERT INTO admin_sessions(token_hash, expires_at) VALUES (?, unixepoch() + 2592000)",
    )
    .bind(hash)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(Json(json!({"token": token, "expires_in": 2592000})))
}

pub async fn session(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let username: Option<String> =
        sqlx::query_scalar("SELECT username FROM admin_account WHERE id = 1")
            .fetch_optional(&state.db)
            .await?;
    Ok(Json(json!({"authenticated": true, "username": username})))
}

pub async fn logout(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<StatusCode> {
    if let Some(token) = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
    {
        let hash = format!("{:x}", Sha256::digest(token.as_bytes()));
        sqlx::query("DELETE FROM admin_sessions WHERE token_hash = ?")
            .bind(hash)
            .execute(&state.db)
            .await?;
    }
    Ok(StatusCode::NO_CONTENT)
}
