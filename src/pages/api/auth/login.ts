import type { APIRoute } from "astro";
import { apiOrigin } from "@/core/content/blog";
import { saveSession } from "@/core/admin/session";
export const prerender = false;
export const POST: APIRoute = async ({ request, url, cookies }) => {
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin)
    return new Response("Forbidden", { status: 403 });
  if (!request.headers.get("content-type")?.includes("application/json"))
    return new Response("Invalid content type", { status: 415 });
  try {
    // A bounded stream prevents large unauthenticated login requests from being buffered.
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 4096) {
          await reader.cancel();
          return new Response("Request too large", { status: 413 });
        }
        chunks.push(value);
      }
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const response = await fetch(`${apiOrigin()}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: bytes,
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
    });
    const result = await response.json();
    if (response.ok && /^[a-f0-9]{64}$/.test(result.token)) {
      saveSession(cookies, result.token, url);
      return Response.json({ authenticated: true, expires_in: result.expires_in }, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    return Response.json(result, { status: response.status, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      { error: { message: "登录服务暂时不可用，请稍后重试" } },
      { status: 502 },
    );
  }
};
