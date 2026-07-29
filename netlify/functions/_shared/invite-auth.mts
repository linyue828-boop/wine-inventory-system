import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "wine_inventory_session";
const SESSION_AGE_SECONDS = 7 * 24 * 60 * 60;

interface SessionPayload {
  sub: "invite-member";
  role: "admin";
  exp: number;
}

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

export function isInviteCodeValid(input: string, expected: string) {
  return timingSafeEqual(digest(input), digest(expected));
}

export function createSessionToken(secret: string, now = Date.now()) {
  const payload: SessionPayload = {
    sub: "invite-member",
    role: "admin",
    exp: Math.floor(now / 1000) + SESSION_AGE_SECONDS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifySessionToken(token: string, secret: string, now = Date.now()): SessionPayload | null {
  const [encoded, providedSignature, extra] = token.split(".");
  if (!encoded || !providedSignature || extra) return null;
  const expectedSignature = createHmac("sha256", secret).update(encoded).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(providedSignature, "base64url");
  } catch {
    return null;
  }
  if (provided.length !== expectedSignature.length || !timingSafeEqual(provided, expectedSignature)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as SessionPayload;
    if (payload.sub !== "invite-member" || payload.role !== "admin" || payload.exp <= Math.floor(now / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function readCookie(req: Request, name: string) {
  const cookie = req.headers.get("cookie") || "";
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return "";
}

export function getSession(req: Request, secret: string) {
  return verifySessionToken(readCookie(req, SESSION_COOKIE), secret);
}

export function sessionCookie(token: string) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${SESSION_AGE_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}
