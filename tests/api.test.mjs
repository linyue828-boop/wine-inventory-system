import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const port = 18787;
const base = `http://127.0.0.1:${port}`;
let dataDir;
let child;

function startServer() {
  child = spawn(process.execPath, ["server/index.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), WINE_DATA_DIR: dataDir },
    stdio: "ignore",
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/products`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("测试服务器未启动");
}

test.before(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "wine-inventory-test-"));
  startServer();
  await waitForServer();
});

test.after(async () => {
  child?.kill("SIGTERM");
  await rm(dataDir, { recursive: true, force: true });
});

test("首次初始化为空白酒库", async () => {
  const home = await fetch(base).then((response) => response.text());
  assert.match(home, /酒类仓库 · 库存管理/);
  const products = await fetch(`${base}/api/products`).then((response) => response.json());
  assert.deepEqual(products, []);
});

test("新增、校验、修改库存、查询历史和删除", async () => {
  const invalid = await fetch(`${base}/api/products`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "", quantity: -1 }),
  });
  assert.equal(invalid.status, 400);

  const invalidPrice = await fetch(`${base}/api/products`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "错误价格", quantity: 1, unitPrice: -1 }),
  });
  assert.equal(invalidPrice.status, 400);

  const invalidImage = await fetch(`${base}/api/images`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: "data:text/plain;base64,SGVsbG8=" }),
  });
  assert.equal(invalidImage.status, 400);

  const imageUpload = await fetch(`${base}/api/images`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      data: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    }),
  });
  assert.equal(imageUpload.status, 201);
  const { imagePath } = await imageUpload.json();
  assert.match(imagePath, /^\/uploads\/.+\.png$/);

  const createdResponse = await fetch(`${base}/api/products`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "测试红酒", origin: "法国", year: "2018", alcohol: "13.5",
      aroma: "不详", capacity: "750ml", quantity: 2, unitPrice: 1688.5, inventoryNote: "", imagePath,
      category: "wine", storageLocation: "A区 1号架", reorderPoint: 3,
      categoryDetails: {
        winery: "测试酒庄", country: "法国", region: "波尔多",
        grape: "赤霞珠", wineStyle: "干红", oak: "法国橡木桶",
      },
    }),
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.equal(created.category, "wine");
  assert.equal(created.categoryDetails.region, "波尔多");
  assert.equal(created.storageLocation, "A区 1号架");
  assert.equal(created.unitPrice, 1688.5);

  const updated = await fetch(`${base}/api/products/${created.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...created, quantity: 7, changeNote: "测试入库" }),
  }).then((response) => response.json());
  assert.equal(updated.quantity, 7);

  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
  startServer();
  await waitForServer();

  const history = await fetch(`${base}/api/products/${created.id}/history`).then((response) => response.json());
  assert.equal(history.length, 1);
  assert.equal(history[0].oldQuantity, 2);
  assert.equal(history[0].newQuantity, 7);
  assert.equal(history[0].delta, 5);
  assert.equal(history[0].note, "测试入库");

  const deleted = await fetch(`${base}/api/products/${created.id}`, { method: "DELETE" });
  assert.equal(deleted.status, 200);
  const remaining = await fetch(`${base}/api/products`).then((response) => response.json());
  assert.equal(remaining.length, 0);
});

test("批量导入一次写入多项并拒绝整批无效数据", async () => {
  const makeProduct = (name, category) => ({
    name, category, origin: "不详", year: "不详", alcohol: "不详", aroma: "不详",
    capacity: "不详", quantity: 3, unitPrice: null, inventoryNote: "",
    categoryDetails: {}, storageLocation: "", reorderPoint: 2, imagePath: null,
  });
  const importedResponse = await fetch(`${base}/api/products/bulk`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ products: [makeProduct("批量白酒", "baijiu"), makeProduct("批量红酒", "wine")] }),
  });
  assert.equal(importedResponse.status, 201);
  const imported = await importedResponse.json();
  assert.equal(imported.length, 2);

  const invalidResponse = await fetch(`${base}/api/products/bulk`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ products: [makeProduct("不会写入", "other"), { name: "", quantity: -1 }] }),
  });
  assert.equal(invalidResponse.status, 400);
  const products = await fetch(`${base}/api/products`).then((response) => response.json());
  assert.deepEqual(products.map((item) => item.name).sort(), ["批量白酒", "批量红酒"]);
});
