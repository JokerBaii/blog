use crate::error::{ApiError, ApiResult};
use serde::{Deserialize, Serialize};
use sqlx::Row;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArticleInput {
    pub title: String,
    #[serde(default)]
    pub slug: String,
    #[serde(default)]
    pub description: String,
    pub content_markdown: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default = "default_category")]
    pub category: String,
    #[serde(default)]
    pub published: bool,
}
fn default_category() -> String {
    "tech".into()
}

impl ArticleInput {
    pub fn validate(mut self) -> ApiResult<Self> {
        self.title = self.title.trim().to_owned();
        self.slug = self.slug.trim().to_owned();
        self.description = self.description.trim().to_owned();
        if self.title.is_empty() || self.title.chars().count() > 200 {
            return Err(ApiError::bad("标题需为 1–200 个字符"));
        }
        validate_slug(&self.slug)?;
        if self.description.chars().count() > 1000 {
            return Err(ApiError::bad("摘要不能超过 1000 个字符"));
        }
        if self.content_markdown.trim().is_empty() || self.content_markdown.len() > 1_000_000 {
            return Err(ApiError::bad("正文不能为空，且不能超过 1 MB"));
        }
        if !["tech", "anime", "life"].contains(&self.category.as_str()) {
            return Err(ApiError::bad("无效的文章分类"));
        }
        if self.tags.len() > 20 {
            return Err(ApiError::bad("最多添加 20 个标签"));
        }
        self.tags = self.tags.into_iter().map(|s| s.trim().to_owned()).collect();
        if self
            .tags
            .iter()
            .any(|s| s.is_empty() || s.chars().count() > 40)
        {
            return Err(ApiError::bad("标签需为 1–40 个字符"));
        }
        let mut unique = Vec::new();
        for tag in self.tags {
            if !unique.contains(&tag) {
                unique.push(tag);
            }
        }
        self.tags = unique;
        Ok(self)
    }
}

pub fn validate_slug(slug: &str) -> ApiResult<()> {
    if slug.is_empty()
        || slug.len() > 120
        || !slug
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
        || slug.starts_with('-')
        || slug.ends_with('-')
    {
        return Err(ApiError::bad(
            "文章地址需为 1–120 位小写字母、数字和连字符，且不能以连字符开头或结尾",
        ));
    }
    Ok(())
}

#[derive(Serialize)]
pub struct ArticleSummary {
    pub id: String,
    pub slug: String,
    pub title: String,
    pub description: String,
    pub tags: Vec<String>,
    pub category: String,
    pub published: bool,
    pub created_at: String,
    pub updated_at: String,
    pub published_at: Option<String>,
    pub word_count: usize,
}
impl ArticleSummary {
    pub fn from_row(row: &sqlx::sqlite::SqliteRow) -> ApiResult<Self> {
        let tags: String = row.try_get("tags")?;
        Ok(Self {
            id: row.try_get("id")?,
            slug: row.try_get("slug")?,
            title: row.try_get("title")?,
            description: row.try_get("description")?,
            tags: serde_json::from_str(&tags).map_err(ApiError::internal)?,
            category: row.try_get("category")?,
            published: row.try_get("published")?,
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
            published_at: row.try_get("published_at")?,
            word_count: row.try_get::<i64, _>("word_count")? as usize,
        })
    }
}
pub(crate) fn count_words(markdown: &str) -> usize {
    let mut count = 0;
    for event in pulldown_cmark::Parser::new(markdown) {
        if let pulldown_cmark::Event::Text(text) | pulldown_cmark::Event::Code(text) = event {
            let mut in_word = false;
            for character in text.chars() {
                if ('\u{4e00}'..='\u{9fff}').contains(&character) {
                    count += 1;
                    in_word = false;
                } else if character.is_ascii_alphanumeric() {
                    if !in_word {
                        count += 1;
                    }
                    in_word = true;
                } else {
                    in_word = false;
                }
            }
        }
    }
    count
}

#[derive(Serialize)]
pub struct ArticleDetail {
    #[serde(flatten)]
    pub summary: ArticleSummary,
    pub content_markdown: String,
    pub content_html: String,
    pub attachments: Vec<Attachment>,
}
#[derive(Serialize)]
pub struct Attachment {
    pub id: String,
    pub article_id: String,
    pub filename: String,
    pub size: i64,
    pub created_at: String,
    pub download_url: String,
}
impl Attachment {
    pub fn from_row(row: &sqlx::sqlite::SqliteRow) -> ApiResult<Self> {
        let id: String = row.try_get("id")?;
        Ok(Self {
            download_url: format!("/api/attachments/{id}/download"),
            id,
            article_id: row.try_get("article_id")?,
            filename: row.try_get("filename")?,
            size: row.try_get("size")?,
            created_at: row.try_get("created_at")?,
        })
    }
}
#[derive(Deserialize, Default)]
pub struct ListQuery {
    pub page: Option<u32>,
    pub per_page: Option<u32>,
    pub q: Option<String>,
    pub category: Option<String>,
}
#[derive(Serialize)]
pub struct ArticleList {
    pub items: Vec<ArticleSummary>,
    pub total: i64,
    pub page: u32,
    pub per_page: u32,
}

pub fn markdown_html(markdown: &str) -> String {
    let parser = pulldown_cmark::Parser::new_ext(
        markdown,
        pulldown_cmark::Options::ENABLE_TABLES
            | pulldown_cmark::Options::ENABLE_STRIKETHROUGH
            | pulldown_cmark::Options::ENABLE_TASKLISTS,
    );
    let mut html = String::new();
    pulldown_cmark::html::push_html(&mut html, parser);
    ammonia::clean(&html)
}

// Preview-only block anchors connect rendered paragraphs to Markdown source lines.
// Keep the published article HTML unchanged and sanitize the complete document once.
pub fn markdown_preview_html(markdown: &str) -> String {
    use pulldown_cmark::{Event, Options, Parser};
    let line_starts: Vec<usize> = std::iter::once(0)
        .chain(markdown.match_indices('\n').map(|(offset, _)| offset + 1))
        .collect();
    let parser = Parser::new_ext(
        markdown,
        Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH | Options::ENABLE_TASKLISTS,
    );
    let mut depth = 0usize;
    let events = parser.into_offset_iter().flat_map(|(event, range)| {
        let mut events = Vec::with_capacity(2);
        if matches!(event, Event::Start(_)) {
            if depth == 0 {
                let line = line_starts.partition_point(|start| *start <= range.start);
                events.push(Event::Html(
                    format!("<div data-preview-line=\"{line}\">").into(),
                ));
            }
            depth += 1;
        }
        let end = matches!(event, Event::End(_));
        events.push(event);
        if end {
            depth = depth.saturating_sub(1);
            if depth == 0 {
                events.push(Event::Html("</div>".into()));
            }
        }
        events
    });
    let mut html = String::new();
    pulldown_cmark::html::push_html(&mut html, events);
    ammonia::Builder::default()
        .add_tag_attributes("div", &["data-preview-line"])
        .clean(&html)
        .to_string()
}

#[cfg(test)]
mod preview_tests {
    use super::*;

    #[test]
    fn source_anchors_follow_blocks_and_preview_remains_sanitized() {
        let html = markdown_preview_html(
            "# 标题\n\n正文\n\n- 第一项\n- 第二项\n\n<script>alert(1)</script>\n\n![图](javascript:alert(1))",
        );
        assert!(html.contains("data-preview-line=\"1\""));
        assert!(html.contains("data-preview-line=\"3\""));
        assert!(html.contains("data-preview-line=\"5\""));
        assert!(!html.contains("<script"));
        assert!(!html.contains("javascript:"));
        assert!(!markdown_html("# 标题").contains("data-preview-line"));
    }
}
