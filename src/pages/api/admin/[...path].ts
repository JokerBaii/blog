import type { APIRoute } from "astro";
import { apiOrigin } from "@/core/content/blog";
import { clearSession, sessionToken } from "@/core/admin/session";

export const prerender = false;
const uuid = "[a-f0-9-]{36}";
const routes: [RegExp, string[]][] = [
  [/^articles$/, ["GET", "POST"]],
  [/^articles\/by-slug\/[a-z0-9](?:[a-z0-9-]{0,118}[a-z0-9])?$/, ["GET"]],
  [new RegExp(`^articles/${uuid}$`), ["GET", "PUT", "DELETE"]],
  [new RegExp(`^attachments/${uuid}$`), ["DELETE"]],
  [new RegExp(`^attachments/${uuid}/download$`), ["GET", "HEAD"]],
  [/^avatar$/, ["POST"]],
  [/^page-content$/, ["GET", "PUT"]],
  [/^logout$/, ["POST"]],
  [/^preview$/, ["POST"]],
];
const proxy: APIRoute = async ({ params, request, url, cookies }) => {
  const path = params.path ?? "";
  const route = routes.find(([pattern]) => pattern.test(path));
  if (!route) return new Response("Not found", { status: 404 });
  if (!route[1].includes(request.method))
    return new Response("Method not allowed", { status: 405 });
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin)
    return new Response("Forbidden", { status: 403 });
  // The browser's HttpOnly session is verified by the backend on every operation.
  // Explicit bearer authentication remains available for API clients.
  const cookieToken = sessionToken(cookies);
  const authorization = request.headers.get("authorization") || (cookieToken ? `Bearer ${cookieToken}` : "");
  if (cookieToken && !request.headers.has("authorization") && !["GET", "HEAD"].includes(request.method) && origin !== url.origin)
    return new Response("Forbidden", { status: 403 });
  if (!/^Bearer \S{32,512}$/.test(authorization)) {
    return Response.json(
      { error: { message: "请先登录管理员账号" } },
      { status: 401 },
    );
  }
  const headers = new Headers({ Authorization: authorization });
  for (const name of ["content-type", "range", "if-range"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.headers.get("content-type")?.startsWith("multipart/form-data") ? 120000 : 30000);
  try {
    const options = {
      method: request.method,
      headers,
      redirect: "manual",
      signal: controller.signal,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      duplex: "half",
    } as RequestInit & { duplex: "half" };
    const response = await fetch(
      `${apiOrigin()}/api/admin/${path}${url.search}`,
      options,
    );
    if (response.status === 401 || (path === "logout" && response.ok)) clearSession(cookies);
    const outgoing = new Headers({ "Cache-Control": "no-store" });
    for (const name of [
      "content-type",
      "content-disposition",
      "content-length",
      "content-range",
      "accept-ranges",
    ]) {
      const value = response.headers.get(name);
      if (value) outgoing.set(name, value);
    }
    return new Response(response.body, {
      status: response.status,
      headers: outgoing,
    });
  } catch {
    return Response.json(
      {
        error: {
          message: "文章服务暂时不可用，请稍后重试。正文仍保留在编辑器中。",
        },
      },
      { status: 502 },
    );
  } finally {
    clearTimeout(timeout);
  }
};
export const GET = proxy;
export const HEAD = proxy;
export const POST = proxy;
export const PUT = proxy;
export const DELETE = proxy;
