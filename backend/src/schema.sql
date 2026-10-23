CREATE TABLE IF NOT EXISTS articles (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    content_markdown TEXT NOT NULL,
    word_count INTEGER NOT NULL DEFAULT 0 CHECK (word_count >= 0),
    tags TEXT NOT NULL DEFAULT '[]',
    category TEXT NOT NULL CHECK (category IN ('tech', 'anime', 'life')),
    published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    published_at TEXT
);
CREATE INDEX IF NOT EXISTS articles_public_order ON articles(published, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS articles_admin_order ON articles(updated_at DESC, id DESC);
CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    size INTEGER NOT NULL CHECK (size > 0),
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS attachments_article ON attachments(article_id, created_at, id);

CREATE TABLE IF NOT EXISTS site_assets (
    name TEXT PRIMARY KEY,
    data BLOB NOT NULL,
    content_type TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS page_content (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    content TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_account (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS login_limit (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    started_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL
);
