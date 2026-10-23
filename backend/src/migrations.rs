use sqlx::Row;

pub async fn word_counts(db: &sqlx::SqlitePool) -> Result<(), sqlx::Error> {
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM pragma_table_info('articles') WHERE name = 'word_count')",
    )
    .fetch_one(db)
    .await?;
    if exists {
        return Ok(());
    }
    let mut transaction = db.begin().await?;
    sqlx::query("ALTER TABLE articles ADD COLUMN word_count INTEGER NOT NULL DEFAULT 0 CHECK (word_count >= 0)")
        .execute(&mut *transaction).await?;
    // Bound migration memory even if existing articles reach the 1 MB body limit.
    let mut last = String::new();
    loop {
        let rows = sqlx::query(
            "SELECT id, content_markdown FROM articles WHERE id > ? ORDER BY id LIMIT 32",
        )
        .bind(&last)
        .fetch_all(&mut *transaction)
        .await?;
        if rows.is_empty() {
            break;
        }
        for row in rows {
            last = row.try_get("id")?;
            let markdown: String = row.try_get("content_markdown")?;
            sqlx::query("UPDATE articles SET word_count = ? WHERE id = ?")
                .bind(crate::models::count_words(&markdown) as i64)
                .bind(&last)
                .execute(&mut *transaction)
                .await?;
        }
    }
    transaction.commit().await
}
