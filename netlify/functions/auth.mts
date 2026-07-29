import type { Config } from "@netlify/functions";
import {
  clearSessionCookie,
  createSessionToken,
  getSession,
  isInviteCodeValid,
  sessionCookie,
} from "./_shared/invite-auth.mts";

function json(value: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const inviteCode = Netlify.env.get("INVENTORY_INVITE_CODE") || "";
  const sessionSecret = Netlify.env.get("INVENTORY_SESSION_SECRET") || "";
  if (!inviteCode || !sessionSecret) return json({ error: "登录服务尚未配置" }, 503);

  if (req.method === "GET" && url.pathname === "/api/auth/session") {
    return getSession(req, sessionSecret)
      ? json({ authenticated: true, role: "admin" })
      : json({ error: "登录已失效，请重新输入邀请码" }, 401);
  }

  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const body = await req.json().catch(() => ({})) as { code?: unknown };
    const code = String(body.code ?? "").trim();
    if (!isInviteCodeValid(code, inviteCode)) {
      return json({ error: "邀请码不正确" }, 401);
    }
    const token = createSessionToken(sessionSecret);
    return json(
      { authenticated: true, role: "admin" },
      200,
      { "Set-Cookie": sessionCookie(token) },
    );
  }

  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    return json(
      { ok: true },
      200,
      { "Set-Cookie": clearSessionCookie() },
    );
  }

  return json({ error: "接口不存在" }, 404);
};

export const config: Config = {
  path: [
    "/api/auth/login",
    "/api/auth/session",
    "/api/auth/logout",
  ],
};
