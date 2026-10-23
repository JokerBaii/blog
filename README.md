# Jokerbai Lab

Jokerbai Lab 使用 Fuyukawa Kagari 二次元手账主题和 Blank 极简主题，Rust 提供文章和附件 API。首页最新文章、归档、详情和搜索读取后端实时数据。原 Kisara 主题与小游戏已移除，LINKS 页面集中展示常用站点。

文章统一在原有主题页面展示，可在写作后台编辑和上传附件。

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

## 写作后台

首次入站会按首屏图片、字体和会话检查的实际完成进度显示开屏动画，随后提供站长登录和「以旅人身份进入」。统一登录页为 `/login/`，普通登录后进入当前主题的主页；只有从编辑入口进入登录时，才返回对应的编辑位置。未登录访问 `/admin/` 会先跳转到统一登录页，后台不再保留第二套登录表单。管理员登录后可进入 `/admin/`；前台页脚「入站入口」可以再次打开登录面板。本机管理员用户名为 `jokerbai`，初始密码保存在仅本机用户可读的 `backend/admin-credentials.txt`，该文件已排除在 Git 之外。

后台使用与前台一致的浅色纸张风格，配备右下角角色插图。Markdown 编辑器支持行号、语法高亮、撤销重做和查找，`Ctrl/Cmd S` 保存、`Ctrl/Cmd Shift V` 预览、`Ctrl/Cmd P` 搜索文章。后台支持草稿与发布、文章删除、附件管理和头像上传。选择或拖入附件后，链接会自动插入当前光标位置，不需要另点插入或复制粘贴；再一次保存或发布，正文和附件通过同一个 multipart 请求、同一个数据库事务提交，失败会回滚整次提交并保留编辑器与文件队列，附件链接由后端统一替换。移除待提交附件时自动清理正文引用；删除已上传附件时，附件记录和已保存正文在同一事务内更新，编辑器也同步清理对应引用并保留其他未保存的修改。只有附件的文章也可提交。后台按写文章、个人资料、作品卡片、网站收藏和头像分栏，可以修改个人资料、纪念日，新增或移除网站，并从 39 个图片选项中选择配图和头像（20 张 Q 版贴纸、10 张用户插画原图、9 张透明立绘）。只有管理员能在前台右键菜单看到编辑入口；右键文章卡片或正文可直接编辑对应文章，其他卡片则进入对应配置。文章地址默认由后端自动生成，改标题不会改变已有地址，也可以在文章设置中自定义。头像支持 PNG、JPEG、WebP，最大 2 MB，保存在后端数据库中，各主题通过 `/api/avatar` 读取。文章发布后立即出现在各主题的归档中，无需重新构建。切换文章、保存新文章及切换后台分栏会同步更新当前地址；刷新可继续编辑当前文章，草稿也通过鉴权接口恢复。仅切换发布状态也会触发未保存提示。

写作区默认左侧 Markdown 编辑、右侧实时预览，停止输入约 300 ms 后自动更新；两侧按正文段落位置双向同步滚动，手机上改为上下排列。预览保留脚本禁用的沙箱与 HTML 清理。会话失效时，未保存的文章和页面配置会在当前标签页暂存，重新登录后恢复；刷新前仍会提醒保存。首页刷新会回到顶部，不会恢复旧的页脚滚动位置。

文章没有改动时，保存按钮置灰；修改后启用，撤销或改回已保存内容后再次置灰。已发布文章显示“更新这一页”，草稿勾选公开发布时显示“发布这一页”。附件随文章一起提交，删除附件会同时更新正文与保存状态。

新部署的数据目录需要先使用 `BLOG_ADMIN_TOKEN` 调用 `POST /api/admin/account` 创建账号，JSON 为 `{"username":"你的用户名","password":"至少6字节的密码"}`。账号不会被重复初始化覆盖；部署配置和账号接口说明见后端文档。密码使用 Argon2 哈希，登录会话通过 HttpOnly、SameSite=Strict Cookie 保持 30 天（HTTPS 下设置 Secure），刷新和重新打开浏览器可恢复。退出后服务器撤销会话；每次管理操作都验证有效期。游客只能访问公开内容，无法修改文章、头像和页面配置。

## 构建与运行

```bash
npm run build
npm start
```

构建生成 `dist/client/`（静态资源）和 `dist/server/`（原 Astro 页面的渲染程序）。启动时读取 Rust API，发布和修改文章无需重建前端。首页、归档和文章详情按请求渲染，其他页面继续使用构建生成的静态页面。

`npm run build` 会检查浏览器模块依赖，使用临时空数据 API 渲染页面后检查原有的 HTML、CSS、脚本和媒体体积预算，不需要提前启动真实 Rust 服务，也不会向真实数据库写入测试文章。

部署需要同时运行 Node 前端和 Rust API，已不适合仅托管静态文件的 GitHub Pages。`edgeone.json` 默认使用 `Cache-Control: no-store`，只为明确列出的静态资源配置长缓存，避免登录和后台响应进入公共缓存；如在 EdgeOne 控制台额外配置了强制缓存，也需要让 `/login/`、`/admin/` 和 `/api/` 绕过缓存，参见 [EdgeOne 缓存文档](https://edgeone.ai/document/54213)。可将外部请求代理到前端服务（默认 `127.0.0.1:4321`），Rust API 保持本机监听。公开读取和后台操作均通过前端同源 `/api/` 转发，后台请求由同源桥接读取管理员的 HttpOnly Cookie，再携带会话令牌交给 Rust 验证，不向浏览器 JavaScript 暴露令牌。Cookie 认证的写请求要求同源 Origin。

## 页面与数据

| 页面 | 地址 |
| --- | --- |
| 默认手账首页 | `/` |
| 默认文章归档 | `/blog/` |
| 默认文章详情 | `/blog/{slug}/` |
| 统一登录 | `/login/` |
| 写作后台 | `/admin/` |
| Daily Links | `/games/` |
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

ME、作品卡片与网站收藏的初始内容位于 `src/core/data/page-content-defaults.json`；后台保存后使用 SQLite 数据，两种主题即时同步。字体使用本地 HarmonyOS Sans SC（正文）和 Maple Mono（代码、终端与小标签），原始字体与许可保存在 `public/fonts/`。Blank 在精细鼠标指针下显示圆形反色区域，不影响点击和文字选择；触屏不显示。Blank 不启用拖尾和点击粒子。

## 接口与验证

文章创建、更新、发布、附件上传等用法见 [Rust 后端文档](backend/README.md)。

```bash
cd backend
cargo test
cargo clippy --all-targets -- -D warnings
```

## 许可证与素材

代码许可见 [LICENSE](LICENSE)，文章授权见 [CONTENT_LICENSE.md](CONTENT_LICENSE.md)，第三方图片、角色、模型、音乐等素材说明见 [THIRD_PARTY_ASSETS.md](THIRD_PARTY_ASSETS.md)。原有版权和署名声明保留。

开屏的描边和渐次入场效果参考 [Anime.js SVG 示例](https://animejs.com/documentation/svg/createdrawable/)，使用原生 CSS 实现；图片与字体就绪检测参照浏览器的 `HTMLImageElement.decode()` 与 `document.fonts.ready`，不增加固定等待时长，失败资源有超时回退，用户也可直接跳过。首次选定身份后，同一标签页的浏览不重复打断。Blank 的入站面板与网站收藏页采用黑白极简样式，二次元主题保留插画与手账配色。素材出处继续保存在 `THIRD_PARTY_ASSETS.md`。

## 本机内网部署

当前内网地址：`http://10.17.17.84:4321/`。前端仅绑定这张内网网卡，Rust 仅监听 `127.0.0.1:8787`。系统用户服务已开启，注销登录后继续运行；防火墙仅放行本机所在的 `10.17.0.0/17` 网段访问 4321 端口。

更新代码后运行：

```bash
SITE_URL=http://10.17.17.84:4321 npm run build
cargo build --release --manifest-path backend/Cargo.toml
node scripts/install-lan.mjs 10.17.17.84
```

服务管理：

```bash
systemctl --user status jokerbai-blog-web jokerbai-blog-api
systemctl --user restart jokerbai-blog-web
systemctl --user stop jokerbai-blog-web jokerbai-blog-api
journalctl --user -u jokerbai-blog-web -u jokerbai-blog-api -f
```

内网 IP 来自 DHCP；地址改变时用新地址重新构建、运行安装脚本，并同步调整防火墙规则。内页日语漫画背景仅用于二次元主题的 BLOG、WORKS、LINKS 和 ME，主页和 Blank 不启用。背景以两页并排横向显示，各页用不同原画，来源记录在 `public/illustrations/manga-backgrounds/sources.json`。

Rust 服务使用 release 构建（Thin LTO）。文章字数在写入时缓存，列表不读取或解析正文；旧数据库首次启动时自动分批补齐字数，不改变文章内容。Markdown 渲染在有并发上限的阻塞任务池中执行，避免占住异步请求线程。

## 云服务器部署

访问地址：`http://121.41.195.165/`，站长入口为 `/login/`，写作后台为 `/admin/`。Nginx 监听 80，Node 前端和 Rust API 分别只监听 `127.0.0.1:4321`、`127.0.0.1:8787`。

程序按版本放在 `/opt/jokerbai-lab/releases/`，`current` 软链接指向正在使用的版本。数据库和附件独立放在 `/var/lib/jokerbai-lab/data/`，运行配置位于 `/etc/jokerbai-lab/api.env`，更新程序时保留数据目录。构建包包含本机测试后的前端、生产依赖、Node 运行时和 Rust release 程序；服务器无需运行编译任务。SSH 私钥和运行配置不纳入仓库。

```bash
systemctl status jokerbai-blog-web jokerbai-blog-api nginx
systemctl restart jokerbai-blog-web jokerbai-blog-api
journalctl -u jokerbai-blog-web -u jokerbai-blog-api -f
```

备份需包含整个数据目录；运行期间备份 SQLite 请使用其在线备份接口，避免只复制主数据库而遗漏 WAL 中的写入。
