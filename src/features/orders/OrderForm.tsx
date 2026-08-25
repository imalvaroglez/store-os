import { useState } from "react";
import { useStore } from "../../app/StoreProvider";
import {
  Button,
  SelectField,
  TextArea,
  TextField,
  useToast,
} from "../../design-system";
import { customersForStore } from "../../lib/selectors";
import { defaultTier, tiersForStore } from "../../lib/pricing";
import { parseAmount } from "../../lib/money";
import { todayIso } from "../../lib/dates";
import { ORDER_STATUS_LABELS } from "./orderStatus";
import type { Order, OrderStatus } from "../../types";



const STATUS_OPTIONS: { value: OrderStatus; label: string }[] = (
  Object.keys(ORDER_STATUS_LABELS) as OrderStatus[]
).map((s) => ({ value: s, label: ORDER_STATUS_LABELS[s] }));

export function OrderForm({ order, onDone }: { order: Order; onDone: () => void }) {
  const { state, activeStore, upsertOrder } = useStore();
  const isTiered = activeStore?.type === "inventory_tiered";
  const tiers = tiersForStore(activeStore);
  const def = defaultTier(activeStore) ?? tiers[0];
  const customers = activeStore ? customersForStore(state.customers, activeStore.id) : [];
  const toast = useToast();

  const [draft, setDraft] = useState<Order>(order);
  const [cost, setCost] = useState(order.cost?.toString() ?? "");
  const [price, setPrice] = useState(order.price?.toString() ?? "");
  const [deposit, setDeposit] = useState(order.deposit?.toString() ?? "");
  const [qty, setQty] = useState(order.quantity.toString());
  const [promised, setPromised] = useState(order.promisedDate ?? "");

  // When a product is picked in a tiered store, auto-fill price from the tier.
  function selectProduct(productId: string) {
    const product = state.products.find((p) => p.id === productId);
    if (!product) {
      setDraft({ ...draft, productId: undefined, productName: "" });
      return;
    }
    const tier: string = draft.priceTier ?? def.id;
    const tierPrice = product.prices?.[tier];
    setDraft({
      ...draft,
      productId: product.id,
      productName: product.name,
      cost: product.cost,
    });
    setCost(product.cost?.toString() ?? "");
    if (isTiered && tierPrice != null) setPrice(tierPrice.toString());
    else if (!isTiered && product.price != null) setPrice(product.price.toString());
  }

  function selectTier(tier: string) {
    const product = draft.productId
      ? state.products.find((p) => p.id === draft.productId)
      : undefined;
    const tierPrice = product?.prices?.[tier];
    setDraft({ ...draft, priceTier: tier });
    if (tierPrice != null) setPrice(tierPrice.toString());
  }

  function submit() {
    if (!draft.customerId || !draft.productName.trim()) return;
    const qtyNum = parseAmount(qty) ?? 1;
    const priceNum = parseAmount(price) ?? 0;
    const name = draft.productName.trim();
    // Single-line items[] (mirrored into the flat fields for older readers).
    const item = { productId: draft.productId, productName: name, price: priceNum, quantity: qtyNum };
    const next: Order = {
      ...draft,
      productName: name,
      quantity: qtyNum,
      price: priceNum,
      items: [item],
      deposit: parseAmount(deposit) ?? 0,
      cost: parseAmount(cost),
      promisedDate: promised || undefined,
      updatedAt: new Date().toISOString(),
    };
    if (!isTiered) next.priceTier = undefined;
    upsertOrder(next);

    // Inventory check (tiered stores only): the order is created regardless,
    // but warn Fer when the quantity exceeds stock so they know to reorder.
    if (isTiered && draft.productId) {
      const product = state.products.find((p) => p.id === draft.productId);
      const stock = typeof product?.quantityOnHand === "number" ? product.quantityOnHand : undefined;
      if (typeof stock === "number" && qtyNum > stock) {
        const shortfall = qtyNum - stock;
        toast.error(
          stock > 0
            ? `Pedido creado. Faltan ${shortfall} ${shortfall === 1 ? "pieza" : "piezas"} para surtirlo (hay ${stock}).`
            : `Pedido creado. No hay existencias — faltan las ${qtyNum} ${qtyNum === 1 ? "pieza" : "piezas"}.`
        );
      } else {
        toast.success("Pedido guardado");
      }
    } else {
      toast.success("Pedido guardado");
    }
    onDone();
  }

  const storeProducts = activeStore
    ? state.products.filter((p) => p.storeId === activeStore.id)
    : [];

  return (
    <div className="space-y-4">
      <SelectField
        label="Cliente"
        value={draft.customerId}
        onChange={(next) => setDraft({ ...draft, customerId: next })}
        options={customers.map((c) => ({ value: c.id, label: c.name }))}
        placeholder="Elige un cliente"
      />

      <SelectField
        label="Producto"
        value={draft.productId ?? ""}
        onChange={(next) => selectProduct(next)}
        options={storeProducts.map((p) => ({ value: p.id, label: p.name }))}
        placeholder="Elegir del catálogo…"
      />

      {/* When a catalog product is picked, name + price are inherited — don't ask
          again. The free-text field only shows when there's no product selected,
          for items not in the catalog. */}
      {draft.productId ? (
        <p className="text-xs text-ink-soft">
          Nombre heredado del catálogo: <span className="font-semibold text-ink">{draft.productName}</span>
        </p>
      ) : (
        <TextField
          label="Nombre del producto"
          hint="O escribe uno que no esté en el catálogo."
          value={draft.productName}
          onChange={(e) => setDraft({ ...draft, productName: e.target.value, productId: undefined })}
        />
      )}

      {isTiered ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <TextField
              label="Cantidad"
              inputMode="numeric"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
            <SelectField
              label="Nivel de precio"
              value={draft.priceTier ?? def.id}
              onChange={(next) => selectTier(next)}
              options={tiers.map((t) => ({ value: t.id, label: t.label }))}
            />
          </div>
          <TextField
            label="Precio por pieza"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <TextField
            label="Costo"
            inputMode="decimal"
            placeholder="0"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
          />
          <TextField
            label="Precio de venta"
            inputMode="decimal"
            placeholder="0"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>
      )}

      <TextField
        label="Depósito / anticipo"
        inputMode="decimal"
        placeholder="0"
        value={deposit}
        onChange={(e) => setDeposit(e.target.value)}
      />
      <TextField
        label="Fecha prometida"
        type="date"
        value={promised || todayIso()}
        onChange={(e) => setPromised(e.target.value)}
      />

      <SelectField
        label="Estatus"
        value={draft.status}
        onChange={(next) => setDraft({ ...draft, status: next })}
        options={STATUS_OPTIONS}
      />

      <TextArea
        label="Notas"
        value={draft.notes ?? ""}
        onChange={(e) => setDraft({ ...draft, notes: e.target.value || undefined })}
      />

      <Button
        full
        size="lg"
        onClick={submit}
        disabled={!draft.customerId || !draft.productName.trim()}
      >
        Guardar pedido
      </Button>
    </div>
  );
}
