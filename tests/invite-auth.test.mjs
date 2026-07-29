import test from "node:test";
import assert from "node:assert/strict";
import {
  createSessionToken,
  isInviteCodeValid,
  verifySessionToken,
} from "../netlify/functions/_shared/invite-auth.mts";

test("邀请码只接受完全一致的值", () => {
  assert.equal(isInviteCodeValid("example-long-code", "example-long-code"), true);
  assert.equal(isInviteCodeValid("wrong-code", "example-long-code"), false);
  assert.equal(isInviteCodeValid("", "example-long-code"), false);
});

test("登录会话带签名、可过期且不能篡改", () => {
  const now = Date.parse("2026-07-29T10:00:00Z");
  const token = createSessionToken("test-session-secret", now);
  assert.equal(verifySessionToken(token, "test-session-secret", now)?.role, "admin");
  assert.equal(verifySessionToken(token, "wrong-secret", now), null);
  assert.equal(verifySessionToken(`${token}x`, "test-session-secret", now), null);
  assert.equal(verifySessionToken(token, "test-session-secret", now + 8 * 24 * 60 * 60 * 1000), null);
});
