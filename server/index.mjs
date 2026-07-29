import { createServer } from "node:http";
import { mkdir, unlink, stat } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dataDir = process.env.WINE_DATA_DIR
  ? resolve(process.env.WINE_DATA_DIR)
  : join(root, "data");
const uploadsDir = join(dataDir, "uploads");
const dbPath = join(dataDir, "inventory.sqlite");
const port = Number(process.env.PORT || 8787);

await mkdir(uploadsDir, { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    origin TEXT NOT NULL DEFAULT '不详',
    year TEXT NOT NULL DEFAULT '不详',
    alcohol TEXT NOT NULL DEFAULT '不详',
    aroma TEXT NOT NULL DEFAULT '不详',
    capacity TEXT NOT NULL DEFAULT '不详',
    quantity INTEGER NOT NULL CHECK (quantity >= 0),
    unit_price REAL CHECK (unit_price IS NULL OR unit_price >= 0),
    inventory_note TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'baijiu',
    category_details TEXT NOT NULL DEFAULT '{}',
    storage_location TEXT NOT NULL DEFAULT '',
    reorder_point INTEGER NOT NULL DEFAULT 2,
    image_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS inventory_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    old_quantity INTEGER NOT NULL,
    new_quantity INTEGER NOT NULL,
    delta INTEGER NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    changed_at TEXT NOT NULL,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
  CREATE INDEX IF NOT EXISTS idx_history_product ON inventory_history(product_id, changed_at DESC);
  CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

ensureProductColumn("category", "TEXT NOT NULL DEFAULT 'baijiu'");
ensureProductColumn("category_details", "TEXT NOT NULL DEFAULT '{}'");
ensureProductColumn("storage_location", "TEXT NOT NULL DEFAULT ''");
ensureProductColumn("reorder_point", "INTEGER NOT NULL DEFAULT 2");
ensureProductColumn("unit_price", "REAL");

function ensureProductColumn(name, definition) {
  const columns = db.prepare("PRAGMA table_info(products)").all();
  if (!columns.some((column) => column.name === name)) {
    db.exec(`ALTER TABLE products ADD COLUMN ${name} ${definition}`);
  }
}

function now() {
  return new Date().toISOString();
}

function toProduct(row) {
  return {
    id: row.id,
    name: row.name,
    origin: row.origin,
    year: row.year,
    alcohol: row.alcohol,
    aroma: row.aroma,
    capacity: row.capacity,
    quantity: row.quantity,
    unitPrice: row.unit_price ?? null,
    inventoryNote: row.inventory_note,
    category: row.category || "baijiu",
    categoryDetails: JSON.parse(row.category_details || "{}"),
    storageLocation: row.storage_location || "",
    reorderPoint: row.reorder_point ?? 2,
    imagePath: row.image_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function sendJson(res, statusCode, value) {
  const body = JSON.stringify(value);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function readJson(req, limit = 8 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("请求内容过大"), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw Object.assign(new Error("请求格式不正确"), { status: 400 });
  }
}

function validateProduct(input) {
  const name = String(input.name || "").trim();
  const quantity = Number(input.quantity);
  if (!name) throw Object.assign(new Error("产品名称不能为空"), { status: 400 });
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw Object.assign(new Error("库存数量必须是非负整数"), { status: 400 });
  }
  const clean = (value) => String(value ?? "").trim() || "不详";
  const allowedCategories = new Set(["baijiu", "wine", "spirits", "other"]);
  const category = allowedCategories.has(input.category) ? input.category : "baijiu";
  const reorderPoint = Number(input.reorderPoint ?? 2);
  if (!Number.isInteger(reorderPoint) || reorderPoint < 0) {
    throw Object.assign(new Error("库存预警线必须是非负整数"), { status: 400 });
  }
  const categoryDetails = input.categoryDetails && typeof input.categoryDetails === "object"
    ? Object.fromEntries(Object.entries(input.categoryDetails).map(([key, value]) => [key, String(value ?? "").trim()]))
    : {};
  const unitPrice = input.unitPrice === null || input.unitPrice === undefined || input.unitPrice === ""
    ? null
    : Number(input.unitPrice);
  if (unitPrice !== null && (!Number.isFinite(unitPrice) || unitPrice < 0)) {
    throw Object.assign(new Error("单价必须是大于或等于 0 的数字，也可以留空"), { status: 400 });
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

async function deleteLocalImage(imagePath) {
  if (!imagePath?.startsWith("/uploads/")) return;
  const filename = imagePath.slice("/uploads/".length);
  if (!/^[a-zA-Z0-9._-]+$/.test(filename)) return;
  await unlink(join(uploadsDir, filename)).catch(() => {});
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/products") {
    const q = url.searchParams.get("q")?.trim() || "";
    const origin = url.searchParams.get("origin") || "";
    const aroma = url.searchParams.get("aroma") || "";
    const rows = db
      .prepare(`
        SELECT * FROM products
        WHERE (? = '' OR name LIKE '%' || ? || '%')
          AND (? = '' OR origin = ?)
          AND (? = '' OR aroma = ?)
        ORDER BY updated_at DESC, id DESC
      `)
      .all(q, q, origin, origin, aroma, aroma);
    return sendJson(res, 200, rows.map(toProduct));
  }

  if (req.method === "POST" && url.pathname === "/api/images") {
    const body = await readJson(req);
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(body.data || "");
    if (!match) throw Object.assign(new Error("仅支持 PNG、JPG 或 WebP 图片"), { status: 400 });
    const bytes = Buffer.from(match[2], "base64");
    if (bytes.length > 5 * 1024 * 1024) {
      throw Object.assign(new Error("图片大小不能超过 5MB"), { status: 413 });
    }
    const extensions = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" };
    const filename = `${randomUUID()}${extensions[match[1]]}`;
    await import("node:fs/promises").then(({ writeFile }) => writeFile(join(uploadsDir, filename), bytes));
    return sendJson(res, 201, { imagePath: `/uploads/${filename}` });
  }

  if (req.method === "POST" && url.pathname === "/api/products") {
    const product = validateProduct(await readJson(req));
    const timestamp = now();
    const result = db.prepare(`
      INSERT INTO products
        (name, origin, year, alcohol, aroma, capacity, quantity, unit_price, inventory_note,
         category, category_details, storage_location, reorder_point, image_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      product.name, product.origin, product.year, product.alcohol, product.aroma,
      product.capacity, product.quantity, product.unitPrice, product.inventoryNote, product.category,
      JSON.stringify(product.categoryDetails), product.storageLocation, product.reorderPoint, product.imagePath,
      timestamp, timestamp,
    );
    const row = db.prepare("SELECT * FROM products WHERE id = ?").get(result.lastInsertRowid);
    return sendJson(res, 201, toProduct(row));
  }

  if (req.method === "POST" && url.pathname === "/api/products/bulk") {
    const body = await readJson(req, 2 * 1024 * 1024);
    if (!Array.isArray(body.products) || !body.products.length || body.products.length > 500) {
      throw Object.assign(new Error("批量导入应包含 1 至 500 项酒品"), { status: 400 });
    }
    const products = body.products.map(validateProduct);
    const insert = db.prepare(`
      INSERT INTO products
        (name, origin, year, alcohol, aroma, capacity, quantity, unit_price, inventory_note,
         category, category_details, storage_location, reorder_point, image_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const ids = [];
    db.exec("BEGIN");
    try {
      for (const product of products) {
        const timestamp = now();
        const result = insert.run(
          product.name, product.origin, product.year, product.alcohol, product.aroma,
          product.capacity, product.quantity, product.unitPrice, product.inventoryNote, product.category,
          JSON.stringify(product.categoryDetails), product.storageLocation, product.reorderPoint, null,
          timestamp, timestamp,
        );
        ids.push(result.lastInsertRowid);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    const created = ids.map((id) => toProduct(db.prepare("SELECT * FROM products WHERE id = ?").get(id)));
    return sendJson(res, 201, created);
  }

  const productMatch = /^\/api\/products\/(\d+)$/.exec(url.pathname);
  const historyMatch = /^\/api\/products\/(\d+)\/history$/.exec(url.pathname);

  if (req.method === "GET" && historyMatch) {
    const rows = db.prepare(`
      SELECT id, product_id AS productId, old_quantity AS oldQuantity,
        new_quantity AS newQuantity, delta, note, changed_at AS changedAt
      FROM inventory_history WHERE product_id = ?
      ORDER BY changed_at DESC, id DESC
    `).all(Number(historyMatch[1]));
    return sendJson(res, 200, rows);
  }

  if (req.method === "PUT" && productMatch) {
    const id = Number(productMatch[1]);
    const existing = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
    if (!existing) throw Object.assign(new Error("未找到该酒品"), { status: 404 });
    const product = validateProduct(await readJson(req));
    const timestamp = now();
    db.exec("BEGIN");
    try {
      db.prepare(`
        UPDATE products SET name = ?, origin = ?, year = ?, alcohol = ?, aroma = ?,
          capacity = ?, quantity = ?, unit_price = ?, inventory_note = ?, category = ?, category_details = ?,
          storage_location = ?, reorder_point = ?, image_path = ?, updated_at = ?
        WHERE id = ?
      `).run(
        product.name, product.origin, product.year, product.alcohol, product.aroma,
        product.capacity, product.quantity, product.unitPrice, product.inventoryNote, product.category,
        JSON.stringify(product.categoryDetails), product.storageLocation, product.reorderPoint, product.imagePath,
        timestamp, id,
      );
      if (existing.quantity !== product.quantity) {
        db.prepare(`
          INSERT INTO inventory_history
            (product_id, old_quantity, new_quantity, delta, note, changed_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          id, existing.quantity, product.quantity, product.quantity - existing.quantity,
          product.changeNote, timestamp,
        );
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    if (existing.image_path && existing.image_path !== product.imagePath) {
      await deleteLocalImage(existing.image_path);
    }
    return sendJson(res, 200, toProduct(db.prepare("SELECT * FROM products WHERE id = ?").get(id)));
  }

  if (req.method === "DELETE" && productMatch) {
    const id = Number(productMatch[1]);
    const existing = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
    if (!existing) throw Object.assign(new Error("未找到该酒品"), { status: 404 });
    db.prepare("DELETE FROM products WHERE id = ?").run(id);
    await deleteLocalImage(existing.image_path);
    return sendJson(res, 200, { ok: true });
  }

  throw Object.assign(new Error("接口不存在"), { status: 404 });
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

async function serveFile(req, res, url) {
  let base = join(root, "dist");
  let relative = url.pathname;
  if (url.pathname.startsWith("/uploads/")) {
    base = uploadsDir;
    relative = url.pathname.slice("/uploads".length);
  }
  const safePath = normalize(relative).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
  let filePath = join(base, safePath || "index.html");
  if (!filePath.startsWith(base)) return sendJson(res, 403, { error: "禁止访问" });
  try {
    if ((await stat(filePath)).isDirectory()) filePath = join(filePath, "index.html");
  } catch {
    if (!url.pathname.startsWith("/uploads/")) filePath = join(base, "index.html");
  }
  if (!existsSync(filePath)) return sendJson(res, 404, { error: "文件不存在" });
  const fileStat = await stat(filePath);
  res.writeHead(200, {
    "Content-Type": mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
    "Content-Length": fileStat.size,
    "Cache-Control": url.pathname.startsWith("/uploads/") ? "public, max-age=3600" : "no-cache",
  });
  createReadStream(filePath).pipe(res);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) await handleApi(req, res, url);
    else await serveFile(req, res, url);
  } catch (error) {
    console.error(error);
    sendJson(res, error.status || 500, { error: error.message || "服务器错误" });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`酒类仓库系统已启动：http://127.0.0.1:${port}`);
});

export { server, db };
