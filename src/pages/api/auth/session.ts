import type { APIRoute } from "astro";
import { readSession } from "@/core/admin/session";

export const prerender = false;
export const GET: APIRoute = async ({ cookies }) => {
  const headers = { "Cache-Control": "no-store" };
  try {
    return Response.json(await readSession(cookies), { headers });
  } catch {
    return Response.json({ error: { message: "登录服务暂时不可用，请稍后重试" } }, { status: 503, headers });
  }
};
