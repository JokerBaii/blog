# 第三方素材与复用边界

Yuimi Lab 包含并非由仓库维护者创作的图片、角色画面及其他媒体资源。**代码开源不代表这些资源也获得了同样的授权。**

## 哪些内容不能直接按 MIT 或文章许可使用

除素材自身另有明确许可外，图片、插画、动漫与游戏截图、视频、音乐、音效、字体、角色美术及其衍生素材，均不在本仓库 MIT 许可证和原创文章 CC BY-NC-SA 4.0 许可的授权范围内。

这一边界适用于仓库内的素材文件、文章配图与封面、README 展示图、远程引用的资源，以及嵌入源码或 SVG 中的美术内容。裁剪、抠图、压缩、转码或组合进页面，不会使原作品的权利自动转移给维护者。

第三方库、图标库及其资源遵循各自的许可证。请保留随文件或依赖提供的版权、许可和署名信息；根目录的 MIT 许可证不替代这些条款。

## 复用主题时

你可以按 [MIT 许可证](LICENSE) 复用和修改本项目有权授权的代码与样式，包括商业使用。但在公开部署、分发主题包或制作演示站点前，请独立检查所携带或引用的素材：

- 已有明确来源和许可的，按照原许可使用，并保留要求的署名与说明。
- 来源或授权情况不清楚的，不应将“仓库中可以下载”视为许可；请取得相应许可，或替换为自己创作、有权使用的资源。
- 打包与部署时同时检查主题资源、文章图片、字体、音乐清单、远程链接及 README 展示素材，避免只替换首页背景却遗漏其他资源。

本文件不是逐项素材授权清单，也不表示仓库内所有第三方素材都已经取得分发许可。标注“版权归原作者”或提供来源链接，本身不构成使用授权。维护者不能代原权利人授予这些权利。

## 权利反馈

如果你是相关权利人，发现素材来源、署名或使用存在问题，请通过 [GitHub Issues](https://github.com/Yuimi-chaya/Yuimi-chaya.github.io/issues) 提供文件路径或页面地址、作品来源及具体诉求；涉及不宜公开的信息时，请通过 [维护者主页](https://github.com/Yuimi-chaya) 查找适当联系方式。

## 首页标题字形

手账主题的 `hero-title-jokerbai.svg` 使用 Kalam Regular 的字形轮廓，字体来自 [Google Fonts Kalam](https://github.com/google/fonts/tree/main/ofl/kalam)，按 SIL Open Font License 1.1 使用。许可与版权声明保留在 `public/fonts/OFL-Kalam.txt`；页面使用本地 SVG，无需远程加载字体。

## 蔚蓝档案点击效果

全站点击与鼠标移动拖尾使用 [CialloKing/ba-click-fx](https://github.com/CialloKing/ba-click-fx) 1.3.15，按 MIT 许可使用；包内保留其 LICENSE 和 THIRD_PARTY_NOTICES。该项目为《蔚蓝档案》风格的同人视觉实现，游戏相关权利属于相应权利人。

## 网站字体

正文使用华为 [HarmonyOS Sans SC](https://developer.huawei.com/consumer/cn/design/resource-V1/)，文件直接取自[华为官方字体包](https://developer.huawei.com/images/download/next/HarmonyOS-Sans.zip)，未修改原始字体。版权属于 Huawei Device Co., Ltd.，按 HarmonyOS Sans Fonts License Agreement 随网站打包，许可保存在 `public/fonts/LICENSE-HarmonyOS-Sans.txt`。

代码和终端使用 [Maple Mono v7.9](https://github.com/subframe7536/maple-font/releases/tag/v7.9) 官方 WOFF2 文件，按 SIL Open Font License 1.1 使用，许可保存在 `public/fonts/OFL-MapleMono.txt`。

## ME / WORKS / Daily Links 贴纸

20 张角色贴纸来自 Blue Archive 官方数字周边包 Happy 100th Day! Celebration Digital Merch，使用原始透明 PNG，不修改画面。原下载链接、包内路径与 SHA-256 记录在 `public/links/sources.json`。素材版权属于 Blue Archive / NEXON Korea Corp. / NEXON Games Co., Ltd.（发布时为 NAT GAMES）。依据[官方数字周边说明](https://forum.nexon.com/bluearchive/board_view?board=1044&thread=1881343)，保留署名，仅用于非商业个人博客，不纳入本仓库 MIT 代码许可。原公布的条款及作者标注仍适用。

## 用户提供的竖版插画

`public/illustrations/` 收录用户从本机下载目录提供的 10 张插画。原文件名与 SHA-256 见 `public/illustrations/sources.json`；下载目录中的原始文件保持不变。站点的 `portraits/` 与 `thumbnails/` 为压缩展示副本，`cutouts/` 为通过 imagegen 去除背景的衍生版本。原图版本保留画面与作者标记，不将这些插画或衍生版本纳入代码的 MIT 许可；相关角色及美术权利仍归原权利人。

## 写作编辑器

Markdown 编辑器使用 [CodeMirror](https://codemirror.net/) 的模块，按各依赖自带的 MIT 许可证使用。字体沿用前文的 HarmonyOS Sans SC 与 Maple Mono。

## 内页日语漫画背景

BLOG、WORKS、LINKS、ME 的背景来自葉佐乃《儚いキミは猛攻をはじめる》的不同公开场景，与主页原作相同。八张原始日语页面以 CSS 两页横向铺陈，保留原文，不旋转、不翻译；主页素材和画面不替换。原帖、原始链接、文件摘要见 `public/illustrations/manga-backgrounds/sources.json`。版权归原作者所有，不包含在代码许可证中。此前的英文四格和其他画风的候选图不再使用。
