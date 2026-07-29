import test from "node:test";
import assert from "node:assert/strict";
import {
  canDeleteInventory,
  canWriteInventory,
  resolveInventoryRole,
} from "../netlify/functions/_shared/permissions.mts";

test("库存角色权限遵循管理员、编辑、只读和待授权四档", () => {
  assert.equal(resolveInventoryRole({ roles: ["admin"] }), "admin");
  assert.equal(resolveInventoryRole({ roles: ["editor"] }), "editor");
  assert.equal(resolveInventoryRole({ role: "member" }), "editor");
  assert.equal(resolveInventoryRole({ roles: ["viewer"] }), "viewer");
  assert.equal(resolveInventoryRole({ roles: [] }), "pending");

  assert.equal(canWriteInventory("admin"), true);
  assert.equal(canWriteInventory("editor"), true);
  assert.equal(canWriteInventory("viewer"), false);
  assert.equal(canWriteInventory("pending"), false);
  assert.equal(canDeleteInventory("admin"), true);
  assert.equal(canDeleteInventory("editor"), false);
  assert.equal(canDeleteInventory("viewer"), false);
});
