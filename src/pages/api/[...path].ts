import type { APIRoute } from "astro";
import { apiOrigin } from "@/core/content/blog";

export const prerender = false;
// Same-origin public API/download bridge; never forwards admin credentials.
const proxy: APIRoute = async ({ params, request, url }) => {
  const path = params.path ?? "";
  if (!/^(articles(?:\/[a-z0-9-]+)?|attachments\/[a-f0-9-]{36}\/download)$/.test(path)) {
    return new Response("Not found", { status: 404 });
  }
  const headers = new Headers();
  for (const name of ["range", "if-range", "if-none-match", "if-modified-since"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const controller = new AbortController();
  const connectionTimeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`${apiOrigin()}/api/${path}${url.search}`, {
      method: request.method, headers, redirect: "manual", signal: controller.signal,
    });
    // Only time out opening the upstream request; allow slow downloads to finish.
    clearTimeout(connectionTimeout);
    const outgoing = new Headers(response.headers);
    outgoing.set("Cache-Control", "no-store");
    return new Response(response.body, { status: response.status, headers: outgoing });
  } catch {
    return Response.json({ error: { message: "附件或文章服务暂时不可用，请稍后重试" } }, { status: 502 });
  } finally {
    clearTimeout(connectionTimeout);
  }
};
export const GET = proxy;
export const HEAD = proxy;
