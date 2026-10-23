import type { CollectionEntry } from "astro:content";
import { createMarkdownProcessor } from "@astrojs/markdown-remark";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeExpressiveCode from "rehype-expressive-code";
import { expressiveCodeOptions } from "../../../markdown.config.mjs";

export type Attachment = { id: string; filename: string; size: number; download_url: string };
type ApiArticle = {
  id: string; slug: string; title: string; description: string; category: "tech" | "anime" | "life";
  tags: string[]; published: boolean; created_at: string; updated_at: string; published_at: string | null;
  word_count: number; content_markdown?: string; attachments?: Attachment[];
};
export type BlogPost = {
  id: string;
  data: CollectionEntry<"blog">["data"];
  body: string;
  wordCount: number;
  attachments: Attachment[];
};

export function apiOrigin() {
  return (process.env.BLOG_API_URL || "http://127.0.0.1:8787").replace(/\/+$/, "");
}
async function api(path: string) {
  const response = await fetch(`${apiOrigin()}/api${path}`, { cache: "no-store", signal: AbortSignal.timeout(10000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Rust article API returned ${response.status}`);
  return response.json();
}
function toPost(article: ApiArticle): BlogPost {
  return {
    id: article.slug,
    data: {
      title: article.title, description: article.description, category: article.category,
      tags: article.tags, draft: false, seoKeywords: [],
      pubDate: new Date(article.published_at ?? article.created_at), updatedDate: new Date(article.updated_at),
    },
    body: article.content_markdown ?? "", wordCount: article.word_count ?? 0, attachments: article.attachments ?? [],
  };
}
export async function getPublishedPosts(): Promise<BlogPost[]> {
  const posts: BlogPost[] = [];
  let page = 1;
  for (;;) {
    const result = await api(`/articles?page=${page}&per_page=100`);
    if (!result) throw new Error("Rust article API is unavailable");
    posts.push(...result.items.map(toPost));
    if (page * result.per_page >= result.total || result.items.length === 0) break;
    page += 1;
  }
  return posts;
}
export async function getPublishedPost(slug: string): Promise<BlogPost | null> {
  if (!/^[a-z0-9]+(?:-*[a-z0-9]+)*$/.test(slug)) return null;
  const article = await api(`/articles/${encodeURIComponent(slug)}`);
  return article ? toPost(article) : null;
}

// Retain the existing code frames and heading links; sanitize before highlighting.
let processor: ReturnType<typeof createMarkdownProcessor> | undefined;
export async function renderPost(post: BlogPost) {
  processor ??= createMarkdownProcessor({
    syntaxHighlight: false, remarkPlugins: [remarkGfm],
    rehypePlugins: [rehypeRaw, rehypeSanitize, rehypeSlug,
      [rehypeAutolinkHeadings, { behavior: "append", properties: { className: ["heading-anchor"], ariaLabel: "复制标题链接" }, content: { type: "text", value: "#" } }],
      [rehypeExpressiveCode, expressiveCodeOptions],
    ],
  });
  return (await processor).render(post.body);
}
