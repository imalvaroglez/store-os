import { useState } from "react";
import { Button } from "../../design-system";
import { CatalogScreen } from "./CatalogScreen";
import { CategoriesScreen } from "./CategoriesScreen";

// Catalog tab with two views: Productos and Categorías. A simple in-screen toggle
// keeps both under the existing /catalogo-admin route (no nav/route churn).
export function CatalogTab() {
  const [view, setView] = useState<"products" | "categories">("products");
  return (
    <div>
      <div className="flex gap-1 mb-4 rounded-lg bg-surface-soft p-1 w-full max-w-xs">
        <Button
          variant={view === "products" ? "primary" : "ghost"}
          className="flex-1"
          onClick={() => setView("products")}
        >
          Productos
        </Button>
        <Button
          variant={view === "categories" ? "primary" : "ghost"}
          className="flex-1"
          onClick={() => setView("categories")}
        >
          Categorías
        </Button>
      </div>
      {view === "products" ? <CatalogScreen /> : <CategoriesScreen />}
    </div>
  );
}
