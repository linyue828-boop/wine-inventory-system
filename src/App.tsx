import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { AuthGate } from "./auth";
import { downloadCsvTemplate, parseImportCsv } from "./bulkImport";
import type { ImportPreviewRow } from "./bulkImport";
import type { AuthSession } from "./auth";
import type {
  InventoryHistory,
  Product,
  ProductCategory,
  ProductInput,
} from "./types";

type ViewMode = "cards" | "table";
type StatusFilter = "all" | "low" | "missing-image" | "incomplete";
type StockMode = "in" | "out" | "count";

interface DetailField {
  key: string;
  label: string;
  placeholder: string;
}

const CATEGORY_CONFIG: Record<ProductCategory, {
  label: string;
  english: string;
  mark: string;
  headline: string;
  description: string;
  detailFields: DetailField[];
}> = {
  baijiu: {
    label: "白酒",
    english: "BAIJIU",
    mark: "白",
    headline: "中国白酒藏品",
    description: "按香型、年份与产地管理陈年白酒和纪念酒。",
    detailFields: [],
  },
  wine: {
    label: "红酒",
    english: "WINE",
    mark: "红",
    headline: "葡萄酒藏品",
    description: "围绕酒庄、年份、产区与葡萄品种建立酒窖档案。",
    detailFields: [
      { key: "winery", label: "酒庄 / 生产商", placeholder: "例如：拉菲古堡" },
      { key: "country", label: "国家", placeholder: "例如：法国" },
      { key: "region", label: "产区 / 法定产区", placeholder: "例如：波尔多 · 波亚克" },
      { key: "grape", label: "葡萄品种", placeholder: "例如：赤霞珠、梅洛" },
      { key: "wineStyle", label: "酒款类型", placeholder: "例如：干红、甜白、起泡酒" },
      { key: "oak", label: "桶型 / 陈酿", placeholder: "例如：法国橡木桶 18 个月" },
    ],
  },
  spirits: {
    label: "洋酒",
    english: "SPIRITS",
    mark: "洋",
    headline: "世界烈酒藏品",
    description: "记录酒种、酒厂、酒龄、桶型以及蒸馏装瓶信息。",
    detailFields: [
      { key: "spiritType", label: "洋酒类别", placeholder: "例如：单一麦芽威士忌、干邑、朗姆" },
      { key: "distillery", label: "品牌 / 酒厂", placeholder: "例如：麦卡伦" },
      { key: "countryRegion", label: "国家 / 产区", placeholder: "例如：苏格兰 · 斯佩塞" },
      { key: "ageStatement", label: "酒龄", placeholder: "例如：18 年、NAS" },
      { key: "distilledYear", label: "蒸馏年份", placeholder: "例如：1998" },
      { key: "bottledYear", label: "装瓶年份", placeholder: "例如：2016" },
      { key: "caskType", label: "桶型", placeholder: "例如：雪莉桶、波本桶" },
      { key: "caskNumber", label: "桶号 / 批次", placeholder: "例如：Cask 5386" },
    ],
  },
  other: {
    label: "其他酒类",
    english: "OTHER",
    mark: "其",
    headline: "特色酒类藏品",
    description: "灵活管理药酒、补酒、米酒、黄酒、果酒与其他酒类。",
    detailFields: [
      { key: "otherType", label: "酒类", placeholder: "例如：药酒、补酒、米酒、黄酒" },
      { key: "producer", label: "生产商", placeholder: "请输入厂家或品牌" },
      { key: "ingredients", label: "原料 / 配方", placeholder: "例如：糯米、药材、果实" },
      { key: "style", label: "风格 / 工艺", placeholder: "例如：甜型、浸泡酒、发酵酒" },
    ],
  },
};

function makeEmptyProduct(category: ProductCategory): ProductInput {
  return {
    name: "",
    origin: "不详",
    year: "不详",
    alcohol: "不详",
    aroma: "不详",
    capacity: "不详",
    quantity: 0,
    unitPrice: null,
    inventoryNote: "",
    category,
    categoryDetails: {},
    storageLocation: "",
    reorderPoint: 2,
    imagePath: null,
    changeNote: "",
  };
}

function productToInput(product: Product): ProductInput {
  return {
    name: product.name,
    origin: product.origin,
    year: product.year,
    alcohol: product.alcohol,
    aroma: product.aroma,
    capacity: product.capacity,
    quantity: product.quantity,
    unitPrice: product.unitPrice ?? null,
    inventoryNote: product.inventoryNote,
    category: product.category,
    categoryDetails: product.categoryDetails || {},
    storageLocation: product.storageLocation || "",
    reorderPoint: product.reorderPoint ?? 2,
    imagePath: product.imagePath,
    changeNote: "",
  };
}

function InventoryApp({ session }: { session: AuthSession }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [origin, setOrigin] = useState("");
  const [activeCategory, setActiveCategory] = useState<ProductCategory>("baijiu");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortBy, setSortBy] = useState("recent");
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [editor, setEditor] = useState<Product | "new" | null>(null);
  const [historyProduct, setHistoryProduct] = useState<Product | null>(null);
  const [imageProduct, setImageProduct] = useState<Product | null>(null);
  const [stockProduct, setStockProduct] = useState<{ product: Product; preset: -1 | 1 } | null>(null);
  const [deleteProduct, setDeleteProduct] = useState<Product | null>(null);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [toast, setToast] = useState("");

  const loadProducts = async () => {
    setLoading(true);
    try {
      setProducts(await api.listProducts());
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "数据加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadProducts();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const categoryProducts = useMemo(
    () => products.filter((item) => item.category === activeCategory),
    [products, activeCategory],
  );

  const origins = useMemo(
    () => [...new Set(categoryProducts.map((item) => item.origin).filter((value) => value && value !== "不详"))]
      .sort((a, b) => a.localeCompare(b, "zh-CN")),
    [categoryProducts],
  );

  const filtered = useMemo(() => {
    const key = query.trim().toLocaleLowerCase();
    const items = categoryProducts.filter((item) => {
      const details = Object.values(item.categoryDetails || {}).join(" ").toLocaleLowerCase();
      const matchesSearch = !key
        || item.name.toLocaleLowerCase().includes(key)
        || details.includes(key)
        || item.storageLocation.toLocaleLowerCase().includes(key);
      const matchesStatus =
        statusFilter === "all"
        || (statusFilter === "low" && item.quantity <= item.reorderPoint)
        || (statusFilter === "missing-image" && !item.imagePath)
        || (statusFilter === "incomplete" && isIncomplete(item));
      return matchesSearch && (!origin || item.origin === origin) && matchesStatus;
    });

    return [...items].sort((a, b) => {
      if (sortBy === "quantity-asc") return a.quantity - b.quantity;
      if (sortBy === "quantity-desc") return b.quantity - a.quantity;
      if (sortBy === "price-asc") return (a.unitPrice ?? Number.POSITIVE_INFINITY) - (b.unitPrice ?? Number.POSITIVE_INFINITY);
      if (sortBy === "price-desc") return (b.unitPrice ?? -1) - (a.unitPrice ?? -1);
      if (sortBy === "name") return a.name.localeCompare(b.name, "zh-CN");
      if (sortBy === "year") return String(b.year).localeCompare(String(a.year));
      return b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id;
    });
  }, [categoryProducts, query, origin, statusFilter, sortBy]);

  const categoryQuantity = categoryProducts.reduce((total, item) => total + item.quantity, 0);
  const categoryValue = categoryProducts.reduce(
    (total, item) => total + (item.unitPrice ?? 0) * item.quantity,
    0,
  );
  const pricedCount = categoryProducts.filter((item) => item.unitPrice != null).length;
  const lowStockCount = categoryProducts.filter((item) => item.quantity <= item.reorderPoint).length;
  const config = CATEGORY_CONFIG[activeCategory];

  const updateProductInList = (saved: Product) => {
    setProducts((items) => items.map((item) => item.id === saved.id ? saved : item));
  };

  const removeProduct = async () => {
    if (!deleteProduct) return;
    try {
      await api.deleteProduct(deleteProduct.id);
      setProducts((items) => items.filter((item) => item.id !== deleteProduct.id));
      setDeleteProduct(null);
      setToast("商品已删除");
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    }
  };

  return (
    <div className={`app-shell theme-${activeCategory}`}>
      <header className="topbar">
        <div className="brand-mark">酒</div>
        <div className="brand-copy">
          <p>WINE INVENTORY</p>
          <h1>酒类仓库</h1>
        </div>
        <div className="topbar-account">
          <div>
            <span>{session.name}</span>
            <strong>{session.roleLabel}</strong>
          </div>
          {!session.isLocal && <button onClick={() => void session.signOut()}>退出</button>}
        </div>
      </header>

      <nav className="category-nav" aria-label="酒类板块">
        {(Object.keys(CATEGORY_CONFIG) as ProductCategory[]).map((category) => {
          const item = CATEGORY_CONFIG[category];
          const count = products.filter((product) => product.category === category).length;
          return (
            <button
              key={category}
              className={activeCategory === category ? "active" : ""}
              onClick={() => {
                setActiveCategory(category);
                setQuery("");
                setOrigin("");
                setStatusFilter("all");
              }}
            >
              <span className="category-mark">{item.mark}</span>
              <span><strong>{item.label}</strong><small>{item.english}</small></span>
              <em>{count}</em>
            </button>
          );
        })}
      </nav>

      <main>
        <section className="hero">
          <div>
            <span className="eyebrow">{config.english} COLLECTION</span>
            <h2>{config.headline}</h2>
            <p>{config.description}</p>
          </div>
          {session.canEdit ? (
            <div className="hero-actions">
              <button className="secondary-button" onClick={() => setBulkImportOpen(true)}>批量导入</button>
              <button className="primary-button hero-action" onClick={() => setEditor("new")}>
                <span>＋</span> 新增{config.label}
              </button>
            </div>
          ) : <span className="readonly-badge">只读访问</span>}
        </section>

        <section className="stats-grid" aria-label="库存统计">
          <StatCard label={`${config.label}种类`} value={categoryProducts.length} unit="种" note={`当前 ${config.label}板块`} tone="wine" />
          <StatCard label="库存总量" value={categoryQuantity} unit="瓶" note="当前板块在库数量" tone="gold" />
          <ValueStatCard value={categoryValue} pricedCount={pricedCount} totalCount={categoryProducts.length} />
          <StatCard label="库存预警" value={lowStockCount} unit="种" note={lowStockCount ? "达到或低于预警线" : "当前库存状态良好"} tone="ink" />
        </section>

        <section className="inventory-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">COLLECTION LIST</span>
              <h3>{config.label}库存</h3>
            </div>
            <div className="panel-view-actions">
              <span className="result-count">显示 {filtered.length} / {categoryProducts.length} 种</span>
              <div className="view-toggle" aria-label="显示方式">
                <button className={viewMode === "cards" ? "active" : ""} onClick={() => setViewMode("cards")}>卡片</button>
                <button className={viewMode === "table" ? "active" : ""} onClick={() => setViewMode("table")}>表格</button>
              </div>
            </div>
          </div>

          <div className="filters">
            <label className="search-box">
              <span>⌕</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`搜索${config.label}名称、分类或位置…`}
                aria-label="搜索酒品"
              />
              {query && <button onClick={() => setQuery("")} aria-label="清除搜索">×</button>}
            </label>
            {origins.length > 0 && (
              <label>
                <span className="sr-only">产地筛选</span>
                <select value={origin} onChange={(event) => setOrigin(event.target.value)}>
                  <option value="">全部产地</option>
                  {origins.map((value) => <option key={value}>{value}</option>)}
                </select>
              </label>
            )}
            <label>
              <span className="sr-only">状态筛选</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
                <option value="all">全部状态</option>
                <option value="low">库存预警</option>
                <option value="missing-image">待补照片</option>
                <option value="incomplete">信息待完善</option>
              </select>
            </label>
            <label>
              <span className="sr-only">排序方式</span>
              <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
                <option value="recent">最近修改</option>
                <option value="quantity-asc">库存从少到多</option>
                <option value="quantity-desc">库存从多到少</option>
                <option value="price-asc">单价从低到高</option>
                <option value="price-desc">单价从高到低</option>
                <option value="year">年份从新到旧</option>
                <option value="name">按名称排序</option>
              </select>
            </label>
            {(query || origin || statusFilter !== "all") && (
              <button className="text-button" onClick={() => { setQuery(""); setOrigin(""); setStatusFilter("all"); }}>
                重置筛选
              </button>
            )}
          </div>

          {error && <div className="error-banner">{error}<button onClick={() => setError("")}>×</button></div>}
          {loading ? (
            <div className="loading-grid" aria-label="正在加载">
              {Array.from({ length: 6 }, (_, index) => <div className="skeleton" key={index} />)}
            </div>
          ) : filtered.length ? (
            viewMode === "cards" ? (
              <div className="wine-grid">
                {filtered.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    onEdit={() => setEditor(product)}
                    onHistory={() => setHistoryProduct(product)}
                    onImage={() => setImageProduct(product)}
                    onStock={(preset) => setStockProduct({ product, preset })}
                    onDelete={() => setDeleteProduct(product)}
                    canEdit={session.canEdit}
                    canDelete={session.canDelete}
                  />
                ))}
              </div>
            ) : (
              <ProductTable
                products={filtered}
                onEdit={setEditor}
                onHistory={setHistoryProduct}
                onImage={setImageProduct}
                onStock={(product, preset) => setStockProduct({ product, preset })}
                onDelete={setDeleteProduct}
                canEdit={session.canEdit}
                canDelete={session.canDelete}
              />
            )
          ) : (
            <div className="empty-state">
              <span>{config.mark}</span>
              <h4>{categoryProducts.length ? "没有找到符合条件的酒品" : `${config.label}板块还没有藏品`}</h4>
              <p>{categoryProducts.length ? "换一个关键词或清除筛选条件再试试。" : `新增一项，或用 CSV 批量导入你的库存。`}</p>
            </div>
          )}
        </section>
      </main>

      <footer>酒类仓库 · {session.roleLabel} · {session.canEdit ? "所有变更自动保存" : "当前为只读模式"}</footer>

      {editor && (
        <ProductEditor
          product={editor === "new" ? null : editor}
          defaultCategory={activeCategory}
          onClose={() => setEditor(null)}
          onSaved={(saved, created) => {
            setProducts((items) =>
              created ? [saved, ...items] : items.map((item) => item.id === saved.id ? saved : item),
            );
            setActiveCategory(saved.category);
            setEditor(null);
            setToast(created ? "新酒品已入库" : "酒品信息已更新");
          }}
        />
      )}
      {stockProduct && (
        <StockAdjustDialog
          product={stockProduct.product}
          preset={stockProduct.preset}
          onClose={() => setStockProduct(null)}
          onSaved={(saved) => {
            updateProductInList(saved);
            setStockProduct(null);
            setToast("库存数量已更新");
          }}
        />
      )}
      {historyProduct && <HistoryDialog product={historyProduct} onClose={() => setHistoryProduct(null)} />}
      {imageProduct && <ImageDialog product={imageProduct} onClose={() => setImageProduct(null)} />}
      {deleteProduct && (
        <ConfirmDialog
          product={deleteProduct}
          onCancel={() => setDeleteProduct(null)}
          onConfirm={() => void removeProduct()}
        />
      )}
      {bulkImportOpen && (
        <BulkImportDialog
          onClose={() => setBulkImportOpen(false)}
          onImported={(created) => {
            setProducts((items) => [...created.reverse(), ...items]);
            setBulkImportOpen(false);
            setToast(`已成功导入 ${created.length} 项酒品`);
          }}
        />
      )}
      {toast && <div className="toast" role="status">✓ {toast}</div>}
    </div>
  );
}

function BulkImportDialog({ onClose, onImported }: {
  onClose: () => void;
  onImported: (products: Product[]) => void;
}) {
  const [rows, setRows] = useState<ImportPreviewRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const validRows = rows.filter((row) => row.product);
  const invalidRows = rows.filter((row) => row.errors.length);

  const chooseFile = async (file?: File) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return setError("CSV 文件不能超过 2MB");
    try {
      const parsed = parseImportCsv(await file.text());
      if (!parsed.length) throw new Error("模板中没有可导入的数据行");
      if (parsed.length > 500) throw new Error("一次最多导入 500 行");
      setRows(parsed);
      setFileName(file.name);
      setError("");
    } catch (caught) {
      setRows([]);
      setError(caught instanceof Error ? caught.message : "CSV 解析失败");
    }
  };

  const importAll = async () => {
    if (!validRows.length || invalidRows.length) return;
    setSaving(true);
    try {
      const created = await api.importProducts(validRows.map((row) => row.product!));
      onImported(created);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "批量导入失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="dialog bulk-dialog" role="dialog" aria-modal="true" aria-labelledby="bulk-title">
        <div className="dialog-header">
          <div><span className="eyebrow">CSV IMPORT</span><h3 id="bulk-title">批量导入酒品</h3></div>
          <button className="close-button" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className="bulk-body">
          <div className="bulk-guide">
            <div><strong>1. 下载空白模板</strong><span>保留表头，按行填写酒品；分类详情可留空。</span></div>
            <button className="secondary-button" onClick={downloadCsvTemplate}>下载 CSV 模板</button>
          </div>
          <label className="file-drop">
            <strong>2. 选择填写好的 CSV</strong>
            <span>{fileName || "支持 UTF-8 CSV，最多 500 行、2MB"}</span>
            <input type="file" accept=".csv,text/csv" onChange={(event) => void chooseFile(event.target.files?.[0])} />
          </label>
          {error && <p className="form-error">{error}</p>}
          {rows.length > 0 && (
            <>
              <div className="import-summary">
                <strong>预览：{rows.length} 行</strong>
                <span className={invalidRows.length ? "has-errors" : ""}>
                  {invalidRows.length ? `${invalidRows.length} 行需修正` : "全部校验通过"}
                </span>
              </div>
              <div className="import-preview">
                <table>
                  <thead><tr><th>行</th><th>名称</th><th>分类</th><th>库存</th><th>校验结果</th></tr></thead>
                  <tbody>{rows.slice(0, 100).map((row) => (
                    <tr key={row.line} className={row.errors.length ? "invalid" : ""}>
                      <td>{row.line}</td>
                      <td>{row.product?.name || "—"}</td>
                      <td>{row.product ? CATEGORY_CONFIG[row.product.category].label : "—"}</td>
                      <td>{row.product?.quantity ?? "—"}</td>
                      <td>{row.errors.length ? row.errors.join("；") : "可以导入"}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              {rows.length > 100 && <small className="preview-note">仅展示前 100 行，导入时会处理全部数据。</small>}
            </>
          )}
        </div>
        <div className="dialog-footer">
          <button className="secondary-button" onClick={onClose}>取消</button>
          <button className="primary-button" disabled={saving || !validRows.length || invalidRows.length > 0} onClick={() => void importAll()}>
            {saving ? `正在导入…` : `确认导入 ${validRows.length} 项`}
          </button>
        </div>
      </section>
    </div>
  );
}

function isIncomplete(product: Product) {
  if ([product.name, product.capacity, product.alcohol].some((value) => !value || value === "不详")) return true;
  const important: Record<ProductCategory, string[]> = {
    baijiu: [],
    wine: ["winery", "region", "grape"],
    spirits: ["spiritType", "distillery", "caskType"],
    other: ["otherType", "producer"],
  };
  return important[product.category].some((key) => !product.categoryDetails?.[key]);
}

function StatCard({ label, value, unit, note, tone }: {
  label: string; value: number; unit: string; note: string; tone: string;
}) {
  return (
    <article className={`stat-card ${tone}`}>
      <div className="stat-icon">{tone === "wine" ? "藏" : tone === "gold" ? "存" : "警"}</div>
      <div>
        <span>{label}</span>
        <strong>{value.toLocaleString()}<small>{unit}</small></strong>
        <p>{note}</p>
      </div>
    </article>
  );
}

function ValueStatCard({ value, pricedCount, totalCount }: {
  value: number;
  pricedCount: number;
  totalCount: number;
}) {
  return (
    <article className="stat-card value">
      <div className="stat-icon">值</div>
      <div>
        <span>库存参考价值</span>
        <strong className="money-value">{formatMoney(value)}</strong>
        <p>{pricedCount ? `按 ${pricedCount} / ${totalCount} 种已录单价计算` : "暂无单价，待后续补充"}</p>
      </div>
    </article>
  );
}

function ProductCard({ product, onEdit, onHistory, onImage, onStock, onDelete, canEdit, canDelete }: {
  product: Product;
  onEdit: () => void;
  onHistory: () => void;
  onImage: () => void;
  onStock: (preset: -1 | 1) => void;
  onDelete: () => void;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const meta = getProductMeta(product);
  const low = product.quantity <= product.reorderPoint;
  return (
    <article className="wine-card">
      <div className="wine-image">
        {product.imagePath ? (
          <button className="image-open-button" onClick={onImage} title="查看完整大图" aria-label={`查看${product.name}完整大图`}>
            <img src={product.imagePath} alt={product.name} loading="lazy" decoding="async" />
            <span>查看完整大图</span>
          </button>
        ) : (
          <div className="image-placeholder"><span>{CATEGORY_CONFIG[product.category].mark}</span><small>待补照片</small></div>
        )}
        <span className="category-chip">{CATEGORY_CONFIG[product.category].label}</span>
      </div>
      <div className="wine-content">
        <div className="wine-title">
          <div>
            <p>{meta.kicker}</p>
            <h4 title={product.name}>{product.name}</h4>
          </div>
          {canEdit && <button className="icon-button" onClick={onEdit} title="编辑酒品">✎</button>}
        </div>
        <div className={`quantity-display ${low ? "low" : ""}`}>
          <span>{low ? "库存预警" : "当前库存"}</span>
          <strong>{product.quantity.toLocaleString()}<small>瓶</small></strong>
        </div>
        {canEdit && (
          <div className="quick-stock-actions">
            <button onClick={() => onStock(-1)} disabled={product.quantity === 0}>− 出库</button>
            <button onClick={() => onStock(1)}>＋ 入库</button>
          </div>
        )}
        <div className="price-line">
          <span>单价</span>
          <strong>{product.unitPrice == null ? "待补充" : `${formatMoney(product.unitPrice)} / 瓶`}</strong>
          {product.unitPrice != null && <small>库存小计 {formatMoney(product.unitPrice * product.quantity)}</small>}
        </div>
        <dl>
          {meta.fields.map((field) => (
            <div key={field.label}><dt>{field.label}</dt><dd title={field.value}>{field.value}</dd></div>
          ))}
        </dl>
        <p className="location-line"><span>⌖</span>{product.storageLocation || "未设置存放位置"}</p>
        {product.inventoryNote && <p className="inventory-note">备注：{product.inventoryNote}</p>}
        <div className="card-actions">
          <button onClick={onHistory}>库存记录</button>
          {canEdit && <button onClick={onEdit}>完整信息</button>}
          {canDelete && <button className="danger-link" onClick={onDelete}>删除</button>}
        </div>
      </div>
    </article>
  );
}

function ProductTable({ products, onEdit, onHistory, onImage, onStock, onDelete, canEdit, canDelete }: {
  products: Product[];
  onEdit: (product: Product) => void;
  onHistory: (product: Product) => void;
  onImage: (product: Product) => void;
  onStock: (product: Product, preset: -1 | 1) => void;
  onDelete: (product: Product) => void;
  canEdit: boolean;
  canDelete: boolean;
}) {
  return (
    <div className="inventory-table-wrap">
      <table className="inventory-table">
        <thead><tr><th>酒品</th><th>分类信息</th><th>存放位置</th><th>单价 / 价值</th><th>库存</th><th>操作</th></tr></thead>
        <tbody>
          {products.map((product) => {
            const meta = getProductMeta(product);
            const low = product.quantity <= product.reorderPoint;
            return (
              <tr key={product.id}>
                <td>
                  <div className="table-product">
                    <div className="table-thumb">
                      {product.imagePath
                        ? <button onClick={() => onImage(product)} aria-label={`查看${product.name}完整大图`}><img src={product.imagePath} alt="" loading="lazy" decoding="async" /></button>
                        : CATEGORY_CONFIG[product.category].mark}
                    </div>
                    <div><strong>{product.name}</strong><small>{meta.kicker}</small></div>
                  </div>
                </td>
                <td><div className="table-meta">{meta.fields.map((field) => <span key={field.label}>{field.label}：{field.value}</span>)}</div></td>
                <td>{product.storageLocation || <span className="muted">未设置</span>}</td>
                <td>
                  {product.unitPrice == null
                    ? <span className="muted">待补充</span>
                    : <div className="table-price"><strong>{formatMoney(product.unitPrice)}</strong><small>小计 {formatMoney(product.unitPrice * product.quantity)}</small></div>}
                </td>
                <td><strong className={low ? "table-quantity low" : "table-quantity"}>{product.quantity} 瓶</strong><small className="threshold">预警线 {product.reorderPoint}</small></td>
                <td>
                  <div className="table-actions">
                    {canEdit && <button onClick={() => onStock(product, -1)} disabled={product.quantity === 0}>−</button>}
                    {canEdit && <button onClick={() => onStock(product, 1)}>＋</button>}
                    {canEdit && <button onClick={() => onEdit(product)}>编辑</button>}
                    <button onClick={() => onHistory(product)}>记录</button>
                    {canDelete && <button className="danger-link" onClick={() => onDelete(product)}>删除</button>}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function getProductMeta(product: Product) {
  const details = product.categoryDetails || {};
  const capacity = formatCapacity(product.capacity);
  if (product.category === "wine") {
    return {
      kicker: [details.winery, product.year].filter(Boolean).join(" · ") || "葡萄酒藏品",
      fields: [
        { label: "葡萄", value: details.grape || "待完善" },
        { label: "产区", value: details.region || details.country || "待完善" },
        { label: "容量", value: capacity },
      ],
    };
  }
  if (product.category === "spirits") {
    return {
      kicker: [details.distillery, details.countryRegion].filter(Boolean).join(" · ") || "世界烈酒",
      fields: [
        { label: "类别", value: details.spiritType || "待完善" },
        { label: "酒龄", value: details.ageStatement || "待完善" },
        { label: "桶型", value: details.caskType || "待完善" },
      ],
    };
  }
  if (product.category === "other") {
    return {
      kicker: [details.producer, product.origin !== "不详" ? product.origin : ""].filter(Boolean).join(" · ") || "特色酒类",
      fields: [
        { label: "酒类", value: details.otherType || inferOtherType(product.name) },
        { label: "年份", value: product.year },
        { label: "容量", value: capacity },
      ],
    };
  }
  return {
    kicker: `${product.origin} · ${product.year}`,
    fields: [
      { label: "酒精度", value: product.alcohol === "不详" ? "不详" : `${product.alcohol}%` },
      { label: "香型", value: product.aroma },
      { label: "容量", value: capacity },
    ],
  };
}

function inferOtherType(name: string) {
  if (/药酒|活络|杜仲|风湿/.test(name)) return "药酒";
  if (/补酒|龟龄|蛤蚧|健力/.test(name)) return "滋补酒";
  if (/糯米|米酒/.test(name)) return "米酒";
  return "其他";
}

function formatCapacity(value: string) {
  if (!value || value === "不详" || /ml|l/i.test(value)) return value || "不详";
  return `${value} ml`;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

function ProductEditor({ product, defaultCategory, onClose, onSaved }: {
  product: Product | null;
  defaultCategory: ProductCategory;
  onClose: () => void;
  onSaved: (product: Product, created: boolean) => void;
}) {
  const [form, setForm] = useState<ProductInput>(product ? productToInput(product) : makeEmptyProduct(defaultCategory));
  const [preview, setPreview] = useState(product?.imagePath || "");
  const [imageData, setImageData] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const originalQuantity = product?.quantity ?? 0;
  const config = CATEGORY_CONFIG[form.category];

  const update = (field: keyof ProductInput, value: string | number | null | Record<string, string>) =>
    setForm((current) => ({ ...current, [field]: value }));
  const updateDetail = (key: string, value: string) =>
    setForm((current) => ({ ...current, categoryDetails: { ...current.categoryDetails, [key]: value } }));

  const chooseImage = (file?: File) => {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return setError("仅支持 PNG、JPG 或 WebP 图片");
    if (file.size > 5 * 1024 * 1024) return setError("图片大小不能超过 5MB");
    const reader = new FileReader();
    reader.onload = () => {
      setImageData(String(reader.result));
      setPreview(String(reader.result));
      setError("");
    };
    reader.readAsDataURL(file);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.name.trim()) return setError("请输入产品名称");
    if (!Number.isInteger(Number(form.quantity)) || Number(form.quantity) < 0) return setError("库存数量必须是非负整数");
    if (!Number.isInteger(Number(form.reorderPoint)) || Number(form.reorderPoint) < 0) return setError("预警数量必须是非负整数");
    if (form.unitPrice !== null && (!Number.isFinite(Number(form.unitPrice)) || Number(form.unitPrice) < 0)) {
      return setError("单价必须是大于或等于 0 的数字，也可以留空");
    }
    setSaving(true);
    try {
      let imagePath = form.imagePath;
      if (imageData) imagePath = (await api.uploadImage(imageData)).imagePath;
      const payload = {
        ...form,
        quantity: Number(form.quantity),
        unitPrice: form.unitPrice === null ? null : Number(form.unitPrice),
        reorderPoint: Number(form.reorderPoint),
        imagePath,
      };
      const saved = product ? await api.updateProduct(product.id, payload) : await api.createProduct(payload);
      onSaved(saved, !product);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="dialog editor-dialog" role="dialog" aria-modal="true" aria-labelledby="editor-title">
        <div className="dialog-header">
          <div><span className="eyebrow">{product ? "编辑藏品" : "新增入库"}</span><h3 id="editor-title">{product ? product.name : `录入新${config.label}`}</h3></div>
          <button className="close-button" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <form onSubmit={(event) => void save(event)}>
          <div className="editor-layout">
            <div className="photo-editor">
              <div className="photo-preview">
                {preview ? <img src={preview} alt="酒品图片预览" /> : <div className="image-placeholder"><span>{config.mark}</span><small>暂无照片</small></div>}
              </div>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => chooseImage(event.target.files?.[0])} />
              <button type="button" className="secondary-button" onClick={() => fileRef.current?.click()}>{preview ? "更换照片" : "上传照片"}</button>
              {preview && <button type="button" className="text-button" onClick={() => { setPreview(""); setImageData(""); update("imagePath", null); }}>移除照片</button>}
              <small>支持 JPG、PNG、WebP，最大 5MB</small>
            </div>
            <div>
              <div className="category-selector">
                {(Object.keys(CATEGORY_CONFIG) as ProductCategory[]).map((category) => (
                  <button
                    type="button"
                    key={category}
                    className={form.category === category ? "active" : ""}
                    onClick={() => update("category", category)}
                  >{CATEGORY_CONFIG[category].label}</button>
                ))}
              </div>
              <div className="form-section-title">基础信息</div>
              <div className="form-grid">
                <label className="span-2">产品名称 <em>*</em><input autoFocus value={form.name} onChange={(e) => update("name", e.target.value)} placeholder="请输入完整产品名称" /></label>
                {(form.category === "baijiu" || form.category === "other") && <label>产地<input value={form.origin} onChange={(e) => update("origin", e.target.value)} /></label>}
                {(form.category === "baijiu" || form.category === "wine" || form.category === "other") && <label>{form.category === "wine" ? "年份 / 年份酒" : "生产年份"}<input value={form.year} onChange={(e) => update("year", e.target.value)} /></label>}
                <label>酒精度（%）<input value={form.alcohol} onChange={(e) => update("alcohol", e.target.value)} placeholder="例如：53" /></label>
                {form.category === "baijiu" && <label>香型<input value={form.aroma} onChange={(e) => update("aroma", e.target.value)} /></label>}
                <label>容量<input value={form.capacity} onChange={(e) => update("capacity", e.target.value)} placeholder="例如：500ml" /></label>
                <label>存放位置<input value={form.storageLocation} onChange={(e) => update("storageLocation", e.target.value)} placeholder="例如：A区 2号架 3层" /></label>
                <label>库存数量 <em>*</em><input type="number" min="0" step="1" value={form.quantity} onChange={(e) => update("quantity", Number(e.target.value))} /></label>
                <label>单价（元 / 瓶）<input type="number" min="0" step="0.01" value={form.unitPrice ?? ""} onChange={(e) => update("unitPrice", e.target.value === "" ? null : Number(e.target.value))} placeholder="暂无价格可留空" /></label>
                <label>库存预警线<input type="number" min="0" step="1" value={form.reorderPoint} onChange={(e) => update("reorderPoint", Number(e.target.value))} /></label>
              </div>

              {config.detailFields.length > 0 && (
                <>
                  <div className="form-section-title">{config.label}分类信息</div>
                  <div className="form-grid">
                    {config.detailFields.map((field) => (
                      <label key={field.key}>{field.label}<input value={form.categoryDetails[field.key] || ""} onChange={(e) => updateDetail(field.key, e.target.value)} placeholder={field.placeholder} /></label>
                    ))}
                  </div>
                </>
              )}

              <div className="form-section-title">库存说明</div>
              <div className="form-grid">
                <label className="span-2">备注<textarea value={form.inventoryNote} onChange={(e) => update("inventoryNote", e.target.value)} placeholder="包装、品相、存放或其他说明" /></label>
                {product && Number(form.quantity) !== originalQuantity && (
                  <label className="span-2 change-note">本次数量调整说明<input value={form.changeNote} onChange={(e) => update("changeNote", e.target.value)} placeholder="例如：盘点修正、入库 2 瓶" /></label>
                )}
              </div>
            </div>
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="dialog-footer">
            <button type="button" className="secondary-button" onClick={onClose}>取消</button>
            <button className="primary-button" disabled={saving}>{saving ? "保存中…" : product ? "保存修改" : "确认入库"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function StockAdjustDialog({ product, preset, onClose, onSaved }: {
  product: Product;
  preset: -1 | 1;
  onClose: () => void;
  onSaved: (product: Product) => void;
}) {
  const [mode, setMode] = useState<StockMode>(preset > 0 ? "in" : "out");
  const [amount, setAmount] = useState(1);
  const [actual, setActual] = useState(product.quantity);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const nextQuantity = mode === "count" ? actual : product.quantity + (mode === "in" ? amount : -amount);

  const save = async () => {
    if (!Number.isInteger(nextQuantity) || nextQuantity < 0) return setError("调整后的库存不能小于 0");
    setSaving(true);
    try {
      const modeLabel = mode === "in" ? "入库" : mode === "out" ? "出库" : "盘点修正";
      const saved = await api.updateProduct(product.id, {
        ...productToInput(product),
        quantity: nextQuantity,
        changeNote: note.trim() || `${modeLabel}${mode === "count" ? "" : ` ${amount} 瓶`}`,
      });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "库存调整失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="dialog stock-dialog" role="dialog" aria-modal="true">
        <div className="dialog-header">
          <div><span className="eyebrow">QUICK STOCK</span><h3>调整库存 · {product.name}</h3></div>
          <button className="close-button" onClick={onClose}>×</button>
        </div>
        <div className="stock-dialog-body">
          <div className="stock-mode-selector">
            <button className={mode === "in" ? "active" : ""} onClick={() => setMode("in")}>＋ 入库</button>
            <button className={mode === "out" ? "active" : ""} onClick={() => setMode("out")}>− 出库</button>
            <button className={mode === "count" ? "active" : ""} onClick={() => setMode("count")}>◎ 盘点</button>
          </div>
          <div className="stock-calculation">
            <div><span>当前库存</span><strong>{product.quantity}<small>瓶</small></strong></div>
            <b>→</b>
            <div className={nextQuantity <= product.reorderPoint ? "low" : ""}><span>调整后</span><strong>{Math.max(0, nextQuantity)}<small>瓶</small></strong></div>
          </div>
          <label>{mode === "count" ? "实盘数量" : `${mode === "in" ? "入库" : "出库"}数量`}<input type="number" min="0" step="1" value={mode === "count" ? actual : amount} onChange={(e) => mode === "count" ? setActual(Number(e.target.value)) : setAmount(Number(e.target.value))} /></label>
          <label>调整原因<textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="可选，例如：新到货、领用、盘点差异" /></label>
          {error && <p className="form-error">{error}</p>}
        </div>
        <div className="dialog-footer">
          <button className="secondary-button" onClick={onClose}>取消</button>
          <button className="primary-button" disabled={saving} onClick={() => void save()}>{saving ? "保存中…" : "确认调整"}</button>
        </div>
      </section>
    </div>
  );
}

function HistoryDialog({ product, onClose }: { product: Product; onClose: () => void }) {
  const [history, setHistory] = useState<InventoryHistory[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.history(product.id).then(setHistory).finally(() => setLoading(false));
  }, [product.id]);
  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="dialog history-dialog" role="dialog" aria-modal="true">
        <div className="dialog-header">
          <div><span className="eyebrow">库存轨迹</span><h3>{product.name}</h3></div>
          <button className="close-button" onClick={onClose}>×</button>
        </div>
        <div className="current-stock"><span>当前库存</span><strong>{product.quantity}<small>瓶</small></strong></div>
        <div className="history-list">
          {loading ? <p className="history-empty">正在读取记录…</p> : history.length ? history.map((entry) => (
            <article key={entry.id}>
              <span className={`delta ${entry.delta > 0 ? "up" : "down"}`}>{entry.delta > 0 ? "+" : ""}{entry.delta}</span>
              <div><strong>{entry.oldQuantity} → {entry.newQuantity} 瓶</strong><p>{entry.note || "库存数量调整"}</p></div>
              <time>{new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(entry.changedAt))}</time>
            </article>
          )) : <div className="history-empty"><span>◎</span><p>还没有库存变更记录</p><small>调整库存后，记录会自动保存在这里。</small></div>}
        </div>
      </section>
    </div>
  );
}

function ImageDialog({ product, onClose }: { product: Product; onClose: () => void }) {
  return (
    <div className="dialog-backdrop image-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="dialog image-dialog" role="dialog" aria-modal="true" aria-label={`${product.name}完整图片`}>
        <div className="dialog-header">
          <div><span className="eyebrow">FULL IMAGE</span><h3>{product.name}</h3></div>
          <button className="close-button" onClick={onClose} aria-label="关闭大图">×</button>
        </div>
        <div className="full-image-stage">
          <img src={product.imagePath || ""} alt={`${product.name}完整图片`} decoding="sync" />
        </div>
        <div className="image-dialog-footer">
          <span>完整显示 · 原始比例 · 不裁切</span>
          <a href={product.imagePath || ""} target="_blank" rel="noreferrer">在新窗口查看原图</a>
        </div>
      </section>
    </div>
  );
}

function ConfirmDialog({ product, onCancel, onConfirm }: {
  product: Product; onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <div className="dialog-backdrop">
      <section className="dialog confirm-dialog" role="alertdialog" aria-modal="true">
        <div className="warning-icon">!</div>
        <h3>确认删除这项酒品？</h3>
        <p>“{product.name}”及其库存记录和照片将被永久删除，此操作无法撤销。</p>
        <div className="dialog-footer">
          <button className="secondary-button" onClick={onCancel}>取消</button>
          <button className="danger-button" onClick={onConfirm}>确认删除</button>
        </div>
      </section>
    </div>
  );
}

function App() {
  return <AuthGate>{(session) => <InventoryApp session={session} />}</AuthGate>;
}

export default App;
