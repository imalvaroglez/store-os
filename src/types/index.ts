// Store OS data model. Verbatim from the product brief.
// Code/types in English; UI labels in Spanish (Mexico).

export type StoreType = "on_demand" | "inventory_tiered";

export type Store = {
  id: string;
  name: string;
  slug: string;
  type: StoreType;
  whatsappPhone?: string;
  createdAt: string;
  updatedAt: string;
};

export type ProductCategory = "perfume" | "sneakers" | "cap" | "jewelry" | "other";

export type ProductPrices = {
  retail?: number;
  wholesale?: number;
  reseller?: number;
};

export type Product = {
  id: string;
  storeId: string;
  name: string;
  category: ProductCategory;
  imageUrl?: string;
  publicDescription?: string;
  privateNotes?: string;
  isPublic: boolean;

  // on-demand stores use a single `price`.
  cost?: number;
  price?: number;

  // inventory-tiered stores use tiered `prices`.
  prices?: ProductPrices;

  quantityOnHand?: number;
  lowStockAt?: number;

  createdAt: string;
  updatedAt: string;
};

export type Customer = {
  id: string;
  storeId: string;
  name: string;
  phone?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

export type OrderStatus =
  | "asked"
  | "confirmed"
  | "to_buy"
  | "bought"
  | "arrived"
  | "delivered"
  | "paid";

export type PriceTier = "retail" | "wholesale" | "reseller";

export type Order = {
  id: string;
  storeId: string;
  customerId: string;
  productId?: string;
  productName: string;
  quantity: number;
  cost?: number;
  price: number;
  deposit: number;
  status: OrderStatus;
  promisedDate?: string;
  notes?: string;
  priceTier?: PriceTier;
  createdAt: string;
  updatedAt: string;
};

// Whole app state persisted to localStorage.
export type AppState = {
  stores: Store[];
  activeStoreId: string | null;
  products: Product[];
  customers: Customer[];
  orders: Order[];
};
