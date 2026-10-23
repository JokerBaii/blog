import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import { expressiveCodeOptions } from "./markdown.config.mjs";
import { unified } from "@astrojs/markdown-remark";
import expressiveCode from "astro-expressive-code";
import sitemap from "@astrojs/sitemap";
import icon from "astro-icon";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeExpressiveCode from "rehype-expressive-code";
import * as pagefind from "pagefind";
import { fileURLToPath } from "node:url";



const pagefindIntegration = () => ({
  name: "yuimi-pagefind",
  hooks: {
    "astro:build:done": async ({ dir, logger }) => {
      const { index, errors } = await pagefind.createIndex({
        forceLanguage: "zh",
        includeCharacters: "_-:"
      });

      if (!index) {
        logger.warn(`Pagefind index was not created: ${errors.join(", ")}`);
        return;
      }

      const distDir = fileURLToPath(dir);
      const addResult = await index.addDirectory({
        path: distDir,
        glob: "**/*.html"
      });

      if (addResult.errors.length) {
        logger.warn(`Pagefind indexing warnings: ${addResult.errors.join(", ")}`);
      }

      const writeResult = await index.writeFiles({
        outputPath: fileURLToPath(new URL("./pagefind", dir))
      });

      if (writeResult.errors.length) {
        logger.warn(`Pagefind write warnings: ${writeResult.errors.join(", ")}`);
      } else {
        logger.info(`Pagefind indexed ${addResult.page_count} pages.`);
      }

      await pagefind.close();
    }
  }
});

export default defineConfig({
  site: process.env.SITE_URL || "http://localhost:4321",
  output: "static",
  adapter: node({ mode: "standalone" }),
  prefetch: {
    prefetchAll: false,
    defaultStrategy: "tap"
  },
  integrations: [
    expressiveCode(expressiveCodeOptions),
    sitemap({
      filter: (page) => !new URL(page).pathname.startsWith("/themes/") && !new URL(page).pathname.startsWith("/admin/")
    }),
    icon({
      include: {
        tabler: [
          "home-heart",
          "book-2",
          "device-gamepad-2",
          "code",
          "user-heart",
          "search",
          "brand-github",
          "brand-bilibili",
          "sparkles",
          "heart",
          "device-gamepad",
          "movie",
          "pin",
          "terminal-2",
          "flower",
          "mood-smile",
          "chevron-down",
          "palette",
          "x",
          "arrow-up",
          "home",
          "archive",
          "arrow-left",
          "arrow-right",
          "link",
          "copy",
          "file-text",
          "player-play",
          "player-pause",
          "flask-2",
          "user-scan",
          "arrow-back-up",
          "activity-heartbeat",
          "refresh",
          "player-skip-forward",
          "arrow-down",
          "chevron-left",
          "chevron-right",
          "external-link",
          "arrow-up-right",
          "blade",
          "blender",
          "chef-hat",
          "glass-full",
          "hand-finger",
          "hand-grab",
          "tools-kitchen-2",
          "trash"
        ],
        "simple-icons": [
          "cplusplus",
          "unity",
          "blender",
          "unrealengine",
          "github",
          "bilibili",
          "steam",
          "thefinals"
        ]
      }
    }),
    pagefindIntegration()
  ],
  markdown: {
    syntaxHighlight: false,
    processor: unified({
      gfm: true,
      remarkPlugins: [remarkGfm],
      rehypePlugins: [
        rehypeSlug,
        [
          rehypeAutolinkHeadings,
          {
            behavior: "append",
            properties: {
              className: ["heading-anchor"],
              ariaLabel: "复制标题链接"
            },
            content: {
              type: "text",
              value: "#"
            }
          }
        ],
        [rehypeExpressiveCode, expressiveCodeOptions]
      ]
    })
  },
  devToolbar: {
    enabled: false
  }
});
