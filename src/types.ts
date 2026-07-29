export type ProductCategory = "baijiu" | "wine" | "spirits" | "other";

export interface Product {
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

export interface ProductInput {
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
  changeNote?: string;
}

export interface InventoryHistory {
  id: number;
  productId: number;
  oldQuantity: number;
  newQuantity: number;
  delta: number;
  note: string;
  changedAt: string;
}
