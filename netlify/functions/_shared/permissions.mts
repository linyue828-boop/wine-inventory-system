import type { User } from "@netlify/identity";

export type InventoryRole = "admin" | "editor" | "viewer" | "pending";

export function resolveInventoryRole(user: Pick<User, "roles" | "role">): InventoryRole {
  const roles = new Set([...(user.roles || []), user.role || ""].map((role) => role.toLowerCase()));
  if (roles.has("admin")) return "admin";
  if (roles.has("editor") || roles.has("member")) return "editor";
  if (roles.has("viewer")) return "viewer";
  return "pending";
}

export function canWriteInventory(role: InventoryRole) {
  return role === "admin" || role === "editor";
}

export function canDeleteInventory(role: InventoryRole) {
  return role === "admin";
}
