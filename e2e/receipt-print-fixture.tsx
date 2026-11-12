import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { OrderReceipt } from "../src/features/orders/OrderReceipt";
import { Sheet } from "../src/design-system/Sheet";
import { ThemeProvider } from "../src/design-system/theme";
import "../src/index.css";

const data = {
  storeName: "Olivia",
  customer: "Cliente de prueba",
  dateLabel: "5 de noviembre, 2026",
  lines: Array.from({ length: 60 }, (_, index) => ({
    index: index + 1,
    label: `Producto de prueba ${String(index + 1).padStart(2, "0")}`,
    amount: "$1.00",
  })),
  total: "$60.00",
  cobrado: "$10.00",
  saldo: "$50.00",
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <div className="min-h-screen">
        <header id="fixture-admin-header" className="p-4">
          Encabezado administrativo
          <button type="button">Control ajeno al recibo</button>
        </header>
        <Sheet open onClose={() => {}} title="Detalle para compartir">
          <OrderReceipt data={data} />
        </Sheet>
      </div>
    </ThemeProvider>
  </StrictMode>
);
