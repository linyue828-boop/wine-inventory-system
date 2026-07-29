import type { ProductCategory, ProductInput } from "./types";

export interface ImportPreviewRow {
  line: number;
  product: ProductInput | null;
  errors: string[];
}

const HEADERS = [
  "名称", "分类", "产地", "年份", "酒精度", "香型", "容量", "库存数量",
  "单价", "库位", "预警线", "备注", "分类详情(JSON)",
];

const CATEGORY_ALIASES: Record<string, ProductCategory> = {
  白酒: "baijiu",
  红酒: "wine",
  葡萄酒: "wine",
  洋酒: "spirits",
  烈酒: "spirits",
  其他: "other",
  其他酒类: "other",
  baijiu: "baijiu",
  wine: "wine",
  spirits: "spirits",
  other: "other",
};

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (quoted) throw new Error("CSV 中存在未闭合的双引号");
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

export function parseImportCsv(text: string): ImportPreviewRow[] {
  const rows = parseCsv(text.replace(/^\uFEFF/, ""));
  if (!rows.length) throw new Error("CSV 文件为空");
  const headers = rows[0].map((value) => value.trim());
  const missing = HEADERS.filter((header) => !headers.includes(header));
  if (missing.length) throw new Error(`缺少列：${missing.join("、")}`);
  const at = (row: string[], name: string) => (row[headers.indexOf(name)] ?? "").trim();

  return rows.slice(1).map((row, index) => {
    const errors: string[] = [];
    const name = at(row, "名称");
    const category = CATEGORY_ALIASES[at(row, "分类")];
    const quantityText = at(row, "库存数量") || "0";
    const priceText = at(row, "单价");
    const reorderText = at(row, "预警线") || "2";
    const quantity = Number(quantityText);
    const unitPrice = priceText === "" ? null : Number(priceText);
    const reorderPoint = Number(reorderText);
    let categoryDetails: Record<string, string> = {};

    if (!name) errors.push("名称不能为空");
    if (!category) errors.push("分类应为白酒、红酒、洋酒或其他酒类");
    if (!Number.isInteger(quantity) || quantity < 0) errors.push("库存数量应为非负整数");
    if (unitPrice !== null && (!Number.isFinite(unitPrice) || unitPrice < 0)) errors.push("单价应为非负数字或留空");
    if (!Number.isInteger(reorderPoint) || reorderPoint < 0) errors.push("预警线应为非负整数");

    const detailsText = at(row, "分类详情(JSON)");
    if (detailsText) {
      try {
        const parsed = JSON.parse(detailsText);
        if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error();
        categoryDetails = Object.fromEntries(
          Object.entries(parsed).map(([key, value]) => [key, String(value ?? "").trim()]),
        );
      } catch {
        errors.push("分类详情必须是 JSON 对象");
      }
    }

    return {
      line: index + 2,
      errors,
      product: errors.length ? null : {
        name,
        category,
        origin: at(row, "产地") || "不详",
        year: at(row, "年份") || "不详",
        alcohol: at(row, "酒精度") || "不详",
        aroma: at(row, "香型") || "不详",
        capacity: at(row, "容量") || "不详",
        quantity,
        unitPrice,
        storageLocation: at(row, "库位"),
        reorderPoint,
        inventoryNote: at(row, "备注"),
        categoryDetails,
        imagePath: null,
        changeNote: "CSV 批量导入",
      },
    };
  });
}

export function downloadCsvTemplate() {
  const content = `\uFEFF${HEADERS.join(",")}\n`;
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "酒类库存批量导入模板.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}
