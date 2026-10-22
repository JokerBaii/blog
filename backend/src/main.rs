use yuimi_blog_server::{AppState, Config, router};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "yuimi_blog_server=info,tower_http=info".into()),
        )
        .init();
    let config = Config::from_env()?;
    let address = config.bind;
    let state = AppState::open(config).await?;
    let listener = tokio::net::TcpListener::bind(address).await?;
    tracing::info!(%address, "Blog server listening");
    axum::serve(listener, router(state))
        .with_graceful_shutdown(async {
            #[cfg(unix)]
            {
                let mut terminate =
                    tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                        .expect("install SIGTERM handler");
                tokio::select! {
                    _ = tokio::signal::ctrl_c() => {},
                    _ = terminate.recv() => {},
                }
            }
            #[cfg(not(unix))]
            tokio::signal::ctrl_c().await.ok();
        })
        .await?;
    Ok(())
}
