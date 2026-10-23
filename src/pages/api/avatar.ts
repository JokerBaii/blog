import type { APIRoute } from "astro";
import { apiOrigin } from "@/core/content/blog";
export const prerender = false;
const avatar: APIRoute = async ({ request }) => {
  const headers = new Headers();
  const etag = request.headers.get("if-none-match");
  if (etag) headers.set("if-none-match", etag);
  try {
    const response = await fetch(`${apiOrigin()}/api/avatar`, {
      method: request.method,
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
    if (response.ok || response.status === 304) {
      const outgoing = new Headers({
        "Cache-Control": "public, no-cache",
        "X-Content-Type-Options": "nosniff",
      });
      for (const key of ["content-type", "etag", "content-length"]) {
        const value = response.headers.get(key);
        if (value) outgoing.set(key, value);
      }
      return new Response(response.body, {
        status: response.status,
        headers: outgoing,
      });
    }
  } catch {
    /* The default portrait also works before the API is started. */
  }
  return new Response(null, {
    status: 307,
    headers: { Location: "/avatar.svg", "Cache-Control": "no-store" },
  });
};
export const GET = avatar;
export const HEAD = avatar;
