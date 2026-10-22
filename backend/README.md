# Rust 文章与附件 API

Axum + SQLite 后端，配套使用项目现有的 Yuimi-chaya 前端。Rust 仅提供 API，文章展示、搜索和下载使用现有前端页面。

## 运行

```bash
cd backend
cargo run --release
```

本地已生成权限为 0600 的 `.env`，管理员令牌为其中的 `BLOG_ADMIN_TOKEN`。首次安装时，复制 `.env.example` 为 `.env` 并设置随机令牌：

```bash
python3 -c 'import secrets; print(secrets.token_urlsafe(32))'
```

前端在项目根目录通过 `npm run dev` 或构建后 `npm start` 启动。前端使用 `BLOG_API_URL` 指向本服务，默认 `http://127.0.0.1:8787`。

## 配置与数据

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `BLOG_ADMIN_TOKEN` | 必填 | 32–512 字节的随机令牌，不接受占位值 |
| `BLOG_BIND` | `127.0.0.1:8787` | Rust 服务监听地址 |
| `BLOG_DATA_DIR` | 本项目 `backend/data/` | SQLite 数据库及 uploads 目录 |
| `BLOG_MAX_UPLOAD_MB` | `25` | 单个附件上限，可配置 1–1024 MB |
| `RUST_LOG` | `yuimi_blog_server=info,tower_http=info` | 日志级别 |

读取当前工作目录的 `.env`，显式环境变量优先。运行独立二进制时建议显式设置数据目录。首次启动自动建表，不创建示例文章。`data/blog.sqlite3` 保存文章和附件元数据，`data/uploads/` 保存使用 UUID 命名的文件。

备份时停止服务并备份整个 `data/`，包括可能存在的 SQLite WAL/SHM 文件。令牌配置另行保留，恢复时使用同一数据目录。

## API

管理接口要求 `Authorization: Bearer <BLOG_ADMIN_TOKEN>`。公开接口不需要令牌；草稿文章及其附件返回 404。错误 JSON 为 `{"error":{"message":"错误说明"}}`，框架级无效请求可能返回普通文本。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/health` | 健康状态及上传上限 |
| GET | `/api/articles` | 已发布文章列表 |
| GET | `/api/articles/{slug}` | 文章详情和附件列表 |
| GET / HEAD | `/api/attachments/{id}/download` | 公开附件下载，支持 Range |
| GET | `/api/admin/articles` | 包括草稿的文章列表 |
| POST | `/api/admin/articles` | 创建文章 |
| GET / PUT / DELETE | `/api/admin/articles/{id}` | 读取、完整更新、删除文章 |
| POST | `/api/admin/articles/{id}/attachments` | 上传附件，multipart 字段名为 `file` |
| DELETE | `/api/admin/attachments/{id}` | 删除附件 |
| GET / HEAD | `/api/admin/attachments/{id}/download` | 包括草稿附件的鉴权下载 |
| POST | `/api/admin/preview` | 预览 Markdown，返回清理后的 HTML |

列表参数：`page`（默认 1）、`per_page`（默认 20，上限 100）、`q`（标题/摘要/标签）、`category`（`tech`、`anime`、`life`）。返回 `{items,total,page,per_page}`；列表不返回正文，包含估算字数 `word_count`。

创建和更新使用相同结构，更新会完整替换可编辑字段：

```json
{
  "title": "我的文章",
  "slug": "my-first-post",
  "description": "文章摘要",
  "content_markdown": "## 标题\n\n正文内容。",
  "tags": ["Rust", "开发"],
  "category": "tech",
  "published": false
}
```

`slug` 最长 120 位，使用小写字母、数字和连字符，不以连字符开头或结尾，重复时返回 409。正文最多 1 MB，标题最多 200 个字符，摘要最多 1000 个字符，标签最多 20 个且每个不超过 40 个字符。`published` 默认 `false`，时间由服务生成。

详情另外返回 `id`、`created_at`、`updated_at`、`published_at`、`word_count`、`content_html` 和 `attachments`。附件包含 `id`、`article_id`、`filename`、`size`（字节）、`created_at`、`download_url`。

创建文章，将上面的 JSON 存为 `article.json` 后执行：

```bash
# 先在当前终端设置 BLOG_ADMIN_TOKEN，使用 .env 中的值。
curl -X POST http://127.0.0.1:8787/api/admin/articles \
  -H "Authorization: Bearer $BLOG_ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  --data-binary @article.json
```

使用返回的文章 `id` 上传附件：

```bash
curl -X POST http://127.0.0.1:8787/api/admin/articles/文章ID/attachments \
  -H "Authorization: Bearer $BLOG_ADMIN_TOKEN" \
  -F 'file=@./附件.zip'
```

正文可使用 `[下载附件](/api/attachments/附件ID/download)` 插入下载链接。原主题文章页也会自动在正文后列出该文章的全部附件。设置 `published: true` 后，原前端首页和归档立即能读取文章，无需重新构建。

附件流式写入磁盘，超限、空文件和格式不正确的上传会清理临时文件。文件存储路径使用 UUID，原文件名仅用于展示和下载。下载响应强制 `Content-Disposition: attachment`、`application/octet-stream` 和 `nosniff`，支持 UTF-8 文件名。删除文章会同时删除其附件记录和文件，文件清理失败会记入日志。

Markdown HTML 在 API 预览和原前端渲染时都会清理；前端在清理后添加原来的目录、标题锚点和代码块样式。动态页面和下载不缓存，取消发布后公开接口立即隐藏文章和附件。

## 验证

```bash
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

测试使用临时数据库和目录，覆盖草稿隔离、鉴权、文章生命周期、输入校验、并发地址冲突、搜索分页、上传限额及失败清理、附件 Range/HEAD 下载、删除级联和数据重新打开，并确认已删除的独立页面不再提供。
