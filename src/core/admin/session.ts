import type { AstroCookies } from "astro";
import { apiOrigin } from "@/core/content/blog";

const name = "jokerbai_admin_session";
const sessionLifetime = 30 * 24 * 60 * 60;
export function sessionToken(cookies: AstroCookies) {
  const value = cookies.get(name)?.value ?? "";
  return /^[a-f0-9]{64}$/.test(value) ? value : "";
}
export function saveSession(cookies: AstroCookies, token: string, url: URL) {
  cookies.set(name, token, {
    httpOnly: true,
    secure: url.protocol === "https:",
    sameSite: "strict",
    path: "/",
    maxAge: sessionLifetime,
  });
}
export function clearSession(cookies: AstroCookies) {
  cookies.delete(name, { path: "/" });
}

// Pages and API requests use the same server check; the login form never renders inside the desk.
export async function readSession(cookies: AstroCookies): Promise<{ authenticated: boolean; username?: string }> {
  const token = sessionToken(cookies);
  if (!token) return { authenticated: false };
  const response = await fetch(`${apiOrigin()}/api/admin/session`, {
    headers: { Authorization: `Bearer ${token}` }, redirect: "manual", signal: AbortSignal.timeout(10000),
  });
  if (response.status === 401) {
    clearSession(cookies);
    return { authenticated: false };
  }
  if (!response.ok) throw new Error("登录服务暂时不可用，请稍后重试");
  return response.json();
}

export function deskDestination(value: string | null) {
  // Only an explicit editor return path overrides the usual homepage destination.
  if (!value || !/^\/admin\/(?:\?[^#]*)?$/.test(value)) return undefined;
  return value;
}
