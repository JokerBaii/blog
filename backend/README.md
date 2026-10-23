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

管理接口要求 `Authorization: Bearer <令牌>`，可使用 `BLOG_ADMIN_TOKEN` 或登录返回的会话令牌。公开接口不需要令牌；草稿文章及其附件返回 404。错误 JSON 为 `{"error":{"message":"错误说明"}}`，框架级无效请求可能返回普通文本。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/health` | 健康状态及上传上限 |
| POST | `/api/auth/login` | 用户名、密码登录，返回 30 天会话令牌 |
| POST | `/api/admin/account` | 首次初始化唯一管理员账号，已有账号返回 409 |
| GET | `/api/admin/session` | 验证管理员会话 |
| POST | `/api/admin/logout` | 撤销当前登录会话 |
| GET | `/api/page-content` | 公开 ME、WORKS、LINKS 和纪念日内容 |
| GET / PUT | `/api/admin/page-content` | 读取或保存页面内容，需鉴权，最大 64 KB |
| GET | `/api/avatar` | 读取头像，支持 ETag；未设置时返回 404 |
| POST | `/api/admin/avatar` | 原始请求体上传头像，PNG/JPEG/WebP，最大 2 MB |
| GET | `/api/articles` | 已发布文章列表 |
| GET | `/api/articles/{slug}` | 文章详情和附件列表 |
| GET / HEAD | `/api/attachments/{id}/download` | 公开附件下载，支持 Range |
| GET | `/api/admin/articles` | 包括草稿的文章列表 |
| POST | `/api/admin/articles` | 创建文章 |
| GET / PUT / DELETE | `/api/admin/articles/{id}` | 读取、完整更新、删除文章 |
| GET | `/api/admin/articles/by-slug/{slug}` | 按地址读取文章，包括草稿，仅管理员可用 |
| DELETE | `/api/admin/attachments/{id}` | 删除附件 |
| GET / HEAD | `/api/admin/attachments/{id}/download` | 包括草稿附件的鉴权下载 |
| POST | `/api/admin/preview` | 预览 Markdown，返回清理后的 HTML |

账号初始化和登录均使用 JSON `{"username":"jokerbai","password":"你设置的密码"}`。用户名允许 3–40 位英文字母、数字、下划线或连字符，密码为 6–128 字节。密码使用 Argon2 存储；数据库只保存会话令牌哈希。登录限制为全局每分钟最多 10 次尝试。首次初始化应从受信任环境携带配置的管理令牌执行。

配套前端 `/admin/` 提供可视化写作和头像管理。本机生成的 `admin-credentials.txt` 只供本地读取，权限为 0600，不纳入版本控制。页面内容、网站收藏、头像、账号和会话随 `data/blog.sqlite3` 一起持久化；数据库文件与附件目录应一起备份。

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

`slug` 可省略或留空：创建时自动生成唯一地址，更新时保留原地址。自定义 `slug` 最长 120 位，使用小写字母、数字和连字符，不以连字符开头或结尾，重复时返回 409。正文最多 1 MB，标题最多 200 个字符，摘要最多 1000 个字符，标签最多 20 个且每个不超过 40 个字符。`published` 默认 `false`，时间由服务生成。

详情另外返回 `id`、`created_at`、`updated_at`、`published_at`、`word_count`、`content_html` 和 `attachments`。附件包含 `id`、`article_id`、`filename`、`size`（字节）、`created_at`、`download_url`。

创建文章，将上面的 JSON 存为 `article.json` 后执行：

```bash
# 先在当前终端设置 BLOG_ADMIN_TOKEN，使用 .env 中的值。
curl -X POST http://127.0.0.1:8787/api/admin/articles \
  -H "Authorization: Bearer $BLOG_ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  --data-binary @article.json
```

文章与附件通过同一次 multipart 请求提交；无需先保存文章。`article` 字段为上面的 JSON，附件字段为 `file-<UUID>`，正文使用 `attachment:pending-<UUID>` 引用待提交文件，保存时自动替换为下载地址。例如：

```bash
curl -X POST http://127.0.0.1:8787/api/admin/articles \
  -H "Authorization: Bearer $BLOG_ADMIN_TOKEN" \
  -F 'article=<article.json' \
  -F 'file-00000000-0000-4000-8000-000000000001=@./附件.zip'
```

更新文章使用相同的 multipart 结构，发送到 `PUT /api/admin/articles/{id}`。可一次提交多个附件，每个字段使用不同的 UUID。旧的独立附件上传接口已移除。正文未引用的附件会列在文章底部；删除附件也会同步移除正文中的对应链接。设置 `published: true` 后，前端首页和归档立即能读取文章，无需重新构建。

附件流式写入磁盘，超限、空文件和格式不正确的上传会清理临时文件。文件存储路径使用 UUID，原文件名仅用于展示和下载。下载响应强制 `Content-Disposition: attachment`、`application/octet-stream` 和 `nosniff`，支持 UTF-8 文件名。删除文章会同时删除其附件记录和文件，文件清理失败会记入日志。

Markdown HTML 在 API 预览和原前端渲染时都会清理；前端在清理后添加原来的目录、标题锚点和代码块样式。动态页面和下载不缓存，取消发布后公开接口立即隐藏文章和附件。

## 验证

```bash
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

测试使用临时数据库和目录，覆盖草稿隔离、鉴权、文章生命周期、输入校验、并发地址冲突、搜索分页、上传限额及失败清理、附件 Range/HEAD 下载、删除级联和数据重新打开，并确认已删除的独立页面不再提供。

配套前端将登录令牌放入 30 天 HttpOnly Cookie，页面刷新和前台编辑跳转会自动恢复登录。公开代理不转发 Cookie 或管理凭证；后台代理逐次交由 Rust 校验，并拒绝跨站写入。前台通过入站面板提供站长登录和旅人浏览；游客不会显示组件编辑入口。
