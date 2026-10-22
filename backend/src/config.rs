use std::{env, net::SocketAddr, path::PathBuf};

#[derive(Clone)]
pub struct Config {
    pub bind: SocketAddr,
    pub data_dir: PathBuf,
    pub admin_token: String,
    pub max_upload_bytes: usize,
}

impl Config {
    pub fn from_env() -> Result<Self, Box<dyn std::error::Error>> {
        let base = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let admin_token = env::var("BLOG_ADMIN_TOKEN")
            .map_err(|_| "Set BLOG_ADMIN_TOKEN to a random secret of at least 32 characters")?;
        let max_mb: usize = env::var("BLOG_MAX_UPLOAD_MB")
            .unwrap_or_else(|_| "25".into())
            .parse()?;
        if !(1..=1024).contains(&max_mb) {
            return Err("BLOG_MAX_UPLOAD_MB must be between 1 and 1024".into());
        }
        let config = Self {
            bind: env::var("BLOG_BIND")
                .unwrap_or_else(|_| "127.0.0.1:8787".into())
                .parse()?,
            data_dir: env::var_os("BLOG_DATA_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(|| base.join("data")),
            admin_token,
            max_upload_bytes: max_mb * 1024 * 1024,
        };
        config.validate()?;
        Ok(config)
    }

    pub fn validate(&self) -> Result<(), Box<dyn std::error::Error>> {
        if self.admin_token.len() < 32
            || self.admin_token.len() > 512
            || self.admin_token.chars().any(char::is_whitespace)
            || self.admin_token.starts_with("replace-with-")
        {
            return Err("BLOG_ADMIN_TOKEN must contain 32–512 non-whitespace bytes".into());
        }
        if self.max_upload_bytes == 0 || self.max_upload_bytes > 1024 * 1024 * 1024 {
            return Err("Invalid upload size limit".into());
        }
        Ok(())
    }
}
