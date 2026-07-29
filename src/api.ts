import type { InventoryHistory, Product, ProductInput } from "./types";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) window.dispatchEvent(new Event("inventory-auth-expired"));
  if (!response.ok) throw new Error(data.error || "操作失败，请稍后重试");
  return data;
}

export const api = {
  listProducts: () => request<Product[]>("/api/products"),
  createProduct: (product: ProductInput) =>
    request<Product>("/api/products", { method: "POST", body: JSON.stringify(product) }),
  importProducts: (products: ProductInput[]) =>
    request<Product[]>("/api/products/bulk", { method: "POST", body: JSON.stringify({ products }) }),
  updateProduct: (id: number, product: ProductInput) =>
    request<Product>(`/api/products/${id}`, { method: "PUT", body: JSON.stringify(product) }),
  deleteProduct: (id: number) =>
    request<{ ok: true }>(`/api/products/${id}`, { method: "DELETE" }),
  history: (id: number) =>
    request<InventoryHistory[]>(`/api/products/${id}/history`),
  uploadImage: (data: string) =>
    request<{ imagePath: string }>("/api/images", {
      method: "POST",
      body: JSON.stringify({ data }),
    }),
};
