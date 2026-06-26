import { useState } from "react";
import { useStore } from "../../app/StoreProvider";
import {
  Button,
  SelectField,
  TextArea,
  TextField,
} from "../../design-system";
import { customersForStore } from "../../lib/selectors";
import { TIER_LABELS } from "../../lib/labels";
import { parseAmount } from "../../lib/money";
import { todayIso } from "../../lib/dates";
import { ORDER_STATUS_LABELS } from "./orderStatus";
import type { Order, OrderStatus, PriceTier } from "../../types";

const TIER_OPTIONS: { value: PriceTier; label: string }[] = (
  ["retail", "wholesale", "reseller"] as PriceTier[]
).map((t) => ({ value: t, label: TIER_LABELS[t] }));

const STATUS_OPTIONS: { value: OrderStatus; label: string }[] = (
  Object.keys(ORDER_STATUS_LABELS) as OrderStatus[]
).map((s) => ({ value: s, label: ORDER_STATUS_LABELS[s] }));

export function OrderForm({ order, onDone }: { order: Order; onDone: () => void }) {
  const { state, activeStore, upsertOrder } = useStore();
  const isTiered = activeStore?.type === "inventory_tiered";
  const customers = activeStore ? customersForStore(state.customers, activeStore.id) : [];

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
    const tier: PriceTier = draft.priceTier ?? "retail";
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

  function selectTier(tier: PriceTier) {
    const product = draft.productId
      ? state.products.find((p) => p.id === draft.productId)
      : undefined;
    const tierPrice = product?.prices?.[tier];
    setDraft({ ...draft, priceTier: tier });
    if (tierPrice != null) setPrice(tierPrice.toString());
  }

  function submit() {
    if (!draft.customerId || !draft.productName.trim()) return;
    const next: Order = {
      ...draft,
      productName: draft.productName.trim(),
      quantity: parseAmount(qty) ?? 1,
      price: parseAmount(price) ?? 0,
      deposit: parseAmount(deposit) ?? 0,
      cost: parseAmount(cost),
      promisedDate: promised || undefined,
      updatedAt: new Date().toISOString(),
    };
    if (!isTiered) next.priceTier = undefined;
    upsertOrder(next);
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

      <TextField
        label="Nombre del producto"
        hint="O escribe uno que no esté en el catálogo."
        value={draft.productName}
        onChange={(e) => setDraft({ ...draft, productName: e.target.value, productId: undefined })}
      />

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
              value={draft.priceTier ?? "retail"}
              onChange={(next) => selectTier(next)}
              options={TIER_OPTIONS}
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
