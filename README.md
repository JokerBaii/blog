# Yuimi Lab

沿用现有 Yuimi-chaya 前端，Rust 提供文章和附件 API。Kisara、Fuyukawa Kagari、Blank 三个主题的布局、样式、角色资源、动画、音乐和小游戏保留原实现；首页最新文章、归档、详情和搜索读取后端实时数据。

原有示例文章已清空；文章统一在原有主题页面展示。

## 本地运行

需要 Node.js 24 或更新版本、npm 和 Rust 工具链。

终端一，启动 Rust API：

```bash
cd backend
cargo run
```

本地已生成 `backend/.env`，其中的 `BLOG_ADMIN_TOKEN` 是管理接口令牌。首次在其他电脑安装时，复制 `.env.example` 为 `.env` 并设置至少 32 位的随机令牌。数据库和附件默认保存在 `backend/data/`。

终端二，在项目根目录启动原前端：

```bash
npm ci
npm run dev
```

前端地址为 `http://localhost:4321/`，Rust API 默认为 `http://127.0.0.1:8787/api/`。服务端通过 `BLOG_API_URL` 指定 Rust 地址，默认 `http://127.0.0.1:8787`。

## 构建与运行

```bash
npm run build
npm start
```

构建生成 `dist/client/`（静态资源）和 `dist/server/`（原 Astro 页面的渲染程序）。启动时读取 Rust API，发布和修改文章无需重建前端。首页、归档和文章详情按请求渲染，其他页面继续使用构建生成的静态页面。

`npm run build` 会检查浏览器模块依赖，使用临时空数据 API 渲染页面后检查原有的 HTML、CSS、脚本和媒体体积预算，不需要提前启动真实 Rust 服务，也不会向真实数据库写入测试文章。

部署需要同时运行 Node 前端和 Rust API，已不适合仅托管静态文件的 GitHub Pages。可将外部请求代理到前端服务（默认 `127.0.0.1:4321`），Rust API 保持本机监听。文章下载和搜索经前端同源 `/api/` 转发；管理员写入接口通过 Rust 服务访问。

## 页面与数据

| 页面 | 地址 |
| --- | --- |
| 默认 Kisara 首页 | `/` |
| 默认文章归档 | `/blog/` |
| 默认文章详情 | `/blog/{slug}/` |
| 手账主题 | `/themes/fuyukawa-kagari/` |
| 极简主题 | `/themes/blank/` |
| 其他主题的文章 | 对应主题前缀 + `blog/` 或 `blog/{slug}/` |

文章正文使用原有文章模板、目录、代码高亮和阅读交互。附件列表追加在正文末尾，沿用各主题正文样式；上传通过鉴权 API 完成。草稿及其附件不会通过公开页面显示或下载。

- `src/core/content/blog.ts`：Rust 数据到原有文章模板的数据适配及 Markdown 渲染。
- `src/pages/api/[...path].ts`：公开搜索和附件下载的同源转发，支持 HEAD 和 Range，不转发管理接口或令牌。
- `src/themes/`：原有主题页面、样式和运行时。
- `public/themes/`：原有图片、音视频和模型。
- `backend/`：Rust API、SQLite、附件存储及测试。
- `markdown.config.mjs`：从原配置提取的共享代码块样式。

文章来自后端数据库，`src/content/blog/` 暂为空；保留内容 schema 以兼容原模板类型。站点名称和导航仍在 `src/lib/site.ts`，域名在 `astro.config.mjs`。手账主题的音乐文件和播放列表仍在 `public/themes/fuyukawa-kagari/music/`。

## 接口与验证

文章创建、更新、发布、附件上传等用法见 [Rust 后端文档](backend/README.md)。

```bash
cd backend
cargo test
cargo clippy --all-targets -- -D warnings
```

## 许可证与素材

代码许可见 [LICENSE](LICENSE)，文章授权见 [CONTENT_LICENSE.md](CONTENT_LICENSE.md)，第三方图片、角色、模型、音乐等素材说明见 [THIRD_PARTY_ASSETS.md](THIRD_PARTY_ASSETS.md)。原有版权和署名声明保留。
