CREATE TABLE IF NOT EXISTS articles (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    content_markdown TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '[]',
    category TEXT NOT NULL CHECK (category IN ('tech', 'anime', 'life')),
    published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    published_at TEXT
);
CREATE INDEX IF NOT EXISTS articles_public_order ON articles(published, updated_at DESC, id DESC);
CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    size INTEGER NOT NULL CHECK (size > 0),
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS attachments_article ON attachments(article_id, created_at, id);
