import { getDeployStore, getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { getSession } from "./_shared/invite-auth.mts";

type ProductCategory = "baijiu" | "wine" | "spirits" | "other";

interface Product {
  id: number;
  name: string;
  origin: string;
  year: string;
  alcohol: string;
  aroma: string;
  capacity: string;
  quantity: number;
  unitPrice: number | null;
  inventoryNote: string;
  category: ProductCategory;
  categoryDetails: Record<string, string>;
  storageLocation: string;
  reorderPoint: number;
  imagePath: string | null;
  createdAt: string;
  updatedAt: string;
}

interface HistoryEntry {
  id: number;
  productId: number;
  oldQuantity: number;
  newQuantity: number;
  delta: number;
  note: string;
  changedAt: string;
}

interface InventoryState {
  products: Product[];
  history: HistoryEntry[];
  nextProductId: number;
  nextHistoryId: number;
}

interface ProductPayload {
  name?: unknown;
  origin?: unknown;
  year?: unknown;
  alcohol?: unknown;
  aroma?: unknown;
  capacity?: unknown;
  quantity?: unknown;
  unitPrice?: unknown;
  inventoryNote?: unknown;
  category?: unknown;
  categoryDetails?: unknown;
  storageLocation?: unknown;
  reorderPoint?: unknown;
  imagePath?: unknown;
  changeNote?: unknown;
}

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function error(message: string, status = 400) {
  return json({ error: message }, status);
}

function getInventoryStore(context: Context) {
  if (context.deploy?.context === "production") {
    return getStore({ name: "wine-inventory", consistency: "strong" });
  }
  return getDeployStore({ name: "wine-inventory" });
}

async function getState(context: Context): Promise<InventoryState> {
  const store = getInventoryStore(context);
  const existing = await store.get("inventory-state", { type: "json" }) as InventoryState | null;
  if (existing) {
    if (migrateState(existing)) await store.setJSON("inventory-state", existing);
    return existing;
  }

  const state: InventoryState = {
    products: [],
    history: [],
    nextProductId: 1,
    nextHistoryId: 1,
  };
  await store.setJSON("inventory-state", state);
  return state;
}

function migrateState(state: InventoryState) {
  let changed = false;
  for (const product of state.products) {
    const legacy = product as Product & {
      category?: ProductCategory;
      categoryDetails?: Record<string, string>;
      storageLocation?: string;
      reorderPoint?: number;
      unitPrice?: number | null;
    };
    if (!legacy.category) {
      legacy.category = "baijiu";
      changed = true;
    }
    if (!legacy.categoryDetails) {
      legacy.categoryDetails = {};
      changed = true;
    }
    if (legacy.storageLocation === undefined) {
      legacy.storageLocation = "";
      changed = true;
    }
    if (legacy.reorderPoint === undefined) {
      legacy.reorderPoint = 2;
      changed = true;
    }
    if (legacy.unitPrice === undefined) {
      legacy.unitPrice = null;
      changed = true;
    }
  }
  return changed;
}

function validateProduct(input: ProductPayload) {
  const name = String(input.name ?? "").trim();
  const quantity = Number(input.quantity);
  if (!name) throw new Response(JSON.stringify({ error: "产品名称不能为空" }), { status: 400 });
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new Response(JSON.stringify({ error: "库存数量必须是非负整数" }), { status: 400 });
  }
  const clean = (value: unknown) => String(value ?? "").trim() || "不详";
  const categories = new Set<ProductCategory>(["baijiu", "wine", "spirits", "other"]);
  const category = categories.has(input.category as ProductCategory) ? input.category as ProductCategory : "baijiu";
  const reorderPoint = Number(input.reorderPoint ?? 2);
  if (!Number.isInteger(reorderPoint) || reorderPoint < 0) {
    throw new Response(JSON.stringify({ error: "库存预警线必须是非负整数" }), { status: 400 });
  }
  const categoryDetails = input.categoryDetails && typeof input.categoryDetails === "object"
    ? Object.fromEntries(Object.entries(input.categoryDetails).map(([key, value]) => [key, String(value ?? "").trim()]))
    : {};
  const unitPrice = input.unitPrice === null || input.unitPrice === undefined || input.unitPrice === ""
    ? null
    : Number(input.unitPrice);
  if (unitPrice !== null && (!Number.isFinite(unitPrice) || unitPrice < 0)) {
    throw new Response(JSON.stringify({ error: "单价必须是大于或等于 0 的数字，也可以留空" }), { status: 400 });
  }
  return {
    name,
    origin: clean(input.origin),
    year: clean(input.year),
    alcohol: clean(input.alcohol),
    aroma: clean(input.aroma),
    capacity: clean(input.capacity),
    quantity,
    unitPrice,
    inventoryNote: String(input.inventoryNote ?? "").trim(),
    category,
    categoryDetails,
    storageLocation: String(input.storageLocation ?? "").trim(),
    reorderPoint,
    imagePath: input.imagePath ? String(input.imagePath) : null,
    changeNote: String(input.changeNote ?? "").trim(),
  };
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  const length = Number(req.headers.get("content-length") || 0);
  if (length > 8 * 1024 * 1024) throw new Response(JSON.stringify({ error: "请求内容过大" }), { status: 413 });
  try {
    return await req.json();
  } catch {
    throw new Response(JSON.stringify({ error: "请求格式不正确" }), { status: 400 });
  }
}

function parsePath(pathname: string) {
  const product = /^\/api\/products\/(\d+)$/.exec(pathname);
  const history = /^\/api\/products\/(\d+)\/history$/.exec(pathname);
  const image = /^\/api\/images\/([a-zA-Z0-9._-]+)$/.exec(pathname);
  return {
    productId: product ? Number(product[1]) : null,
    historyProductId: history ? Number(history[1]) : null,
    imageKey: image?.[1] || null,
  };
}

export default async (req: Request, context: Context) => {
  try {
    const url = new URL(req.url);
    const { productId, historyProductId, imageKey } = parsePath(url.pathname);
    const sessionSecret = Netlify.env.get("INVENTORY_SESSION_SECRET") || "";
    if (!sessionSecret) return error("登录服务尚未配置", 503);
    if (!getSession(req, sessionSecret)) return error("登录已失效，请重新输入邀请码", 401);
    const store = getInventoryStore(context);

    if (req.method === "GET" && imageKey) {
      const result = await store.getWithMetadata(`images/${imageKey}`, { type: "arrayBuffer" });
      if (!result?.data) return error("图片不存在", 404);
      return new Response(result.data, {
        headers: {
          "Content-Type": String(result.metadata.contentType || "application/octet-stream"),
          "Cache-Control": "public, max-age=86400",
        },
      });
    }

    if (req.method === "POST" && url.pathname === "/api/images") {
      const body = await readBody(req);
      const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(body.data || ""));
      if (!match) return error("仅支持 PNG、JPG 或 WebP 图片");
      const bytes = Uint8Array.from(atob(match[2]), (char) => char.charCodeAt(0));
      if (bytes.byteLength > 5 * 1024 * 1024) return error("图片大小不能超过 5MB", 413);
      const extensions: Record<string, string> = {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/webp": "webp",
      };
      const filename = `${crypto.randomUUID()}.${extensions[match[1]]}`;
      await store.set(`images/${filename}`, bytes.buffer, {
        metadata: { contentType: match[1] },
      });
      return json({ imagePath: `/api/images/${filename}` }, 201);
    }

    const state = await getState(context);

    if (req.method === "GET" && url.pathname === "/api/products") {
      return json([...state.products].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id));
    }

    if (req.method === "GET" && historyProductId !== null) {
      return json(
        state.history
          .filter((entry) => entry.productId === historyProductId)
          .sort((a, b) => b.changedAt.localeCompare(a.changedAt) || b.id - a.id),
      );
    }

    if (req.method === "POST" && url.pathname === "/api/products") {
      const product = validateProduct(await readBody(req) as ProductPayload);
      const timestamp = new Date().toISOString();
      const created: Product = {
        id: state.nextProductId++,
        ...product,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      delete (created as Product & { changeNote?: string }).changeNote;
      state.products.push(created);
      await store.setJSON("inventory-state", state);
      return json(created, 201);
    }

    if (req.method === "POST" && url.pathname === "/api/products/bulk") {
      const body = await readBody(req);
      if (!Array.isArray(body.products) || !body.products.length || body.products.length > 500) {
        return error("批量导入应包含 1 至 500 项酒品");
      }
      const products = body.products.map((item) => validateProduct(item as ProductPayload));
      const timestamp = new Date().toISOString();
      const created = products.map((product) => {
        const item: Product = {
          id: state.nextProductId++,
          ...product,
          imagePath: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        delete (item as Product & { changeNote?: string }).changeNote;
        return item;
      });
      state.products.push(...created);
      await store.setJSON("inventory-state", state);
      return json(created, 201);
    }

    if (req.method === "PUT" && productId !== null) {
      const index = state.products.findIndex((item) => item.id === productId);
      if (index < 0) return error("未找到该酒品", 404);
      const old = state.products[index];
      const product = validateProduct(await readBody(req) as ProductPayload);
      const timestamp = new Date().toISOString();
      const updated: Product = {
        id: old.id,
        name: product.name,
        origin: product.origin,
        year: product.year,
        alcohol: product.alcohol,
        aroma: product.aroma,
        capacity: product.capacity,
        quantity: product.quantity,
        unitPrice: product.unitPrice,
        inventoryNote: product.inventoryNote,
        category: product.category,
        categoryDetails: product.categoryDetails,
        storageLocation: product.storageLocation,
        reorderPoint: product.reorderPoint,
        imagePath: product.imagePath,
        createdAt: old.createdAt,
        updatedAt: timestamp,
      };
      state.products[index] = updated;
      if (old.quantity !== updated.quantity) {
        state.history.push({
          id: state.nextHistoryId++,
          productId,
          oldQuantity: old.quantity,
          newQuantity: updated.quantity,
          delta: updated.quantity - old.quantity,
          note: product.changeNote,
          changedAt: timestamp,
        });
      }
      if (old.imagePath?.startsWith("/api/images/") && old.imagePath !== updated.imagePath) {
        await store.delete(`images/${old.imagePath.slice("/api/images/".length)}`);
      }
      await store.setJSON("inventory-state", state);
      return json(updated);
    }

    if (req.method === "DELETE" && productId !== null) {
      const index = state.products.findIndex((item) => item.id === productId);
      if (index < 0) return error("未找到该酒品", 404);
      const [removed] = state.products.splice(index, 1);
      state.history = state.history.filter((entry) => entry.productId !== productId);
      if (removed.imagePath?.startsWith("/api/images/")) {
        await store.delete(`images/${removed.imagePath.slice("/api/images/".length)}`);
      }
      await store.setJSON("inventory-state", state);
      return json({ ok: true });
    }

    return error("接口不存在", 404);
  } catch (caught) {
    if (caught instanceof Response) {
      const body = await caught.text();
      return new Response(body, {
        status: caught.status,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }
    console.error(caught);
    return error("服务器错误", 500);
  }
};

export const config: Config = {
  path: [
    "/api/products",
    "/api/products/bulk",
    "/api/products/:id",
    "/api/products/:id/history",
    "/api/images",
    "/api/images/:key",
  ],
};
