import { useMemo, useState } from "react";
import { useStore, newCustomer } from "../../app/StoreProvider";
import {
  Badge,
  Button,
  Card,
  Dialog,
  IconButton,
  Money,
  SearchSelect,
  SelectField,
  StatRow,
  TextArea,
  TextField,
  useToast,
} from "../../design-system";
import { customersForStore } from "../../lib/selectors";
import { defaultTier, tiersForStore } from "../../lib/pricing";
import { formatMoney, parseAmount, sanitizeDecimalInput, sanitizeIntegerInput } from "../../lib/money";
import { effectiveOrderStatus, orderItems, orderTotals, paymentStatusForOrder, tierWarning } from "../../lib/orders";
import { uid } from "../../lib/ids";
import { ORDER_STATUS_LABELS } from "./orderStatus";
import { CustomerForm } from "../customers/CustomerForm";
import { CURRENT_ORDER_SCHEMA_VERSION } from "../../types";
import type { Order, OrderItem, OrderStatus, Product } from "../../types";

type DraftLine = OrderItem & {
  key: string;
  quantityText: string;
  unitPriceText: string;
  costText: string;
  productQuery: string;
};

const STATUS_OPTIONS: { value: OrderStatus; label: string }[] = (
  Object.keys(ORDER_STATUS_LABELS) as OrderStatus[]
).filter((status) => status !== "requested")
  .map((status) => ({ value: status, label: ORDER_STATUS_LABELS[status] }));

function lineFromItem(item?: OrderItem): DraftLine {
  const quantity = item?.quantity ?? 1;
  const unitPrice = item?.unitPrice ?? 0;
  return {
    key: uid("line"),
    productId: item?.productId,
    productName: item?.productName ?? "",
    productQuery: item?.productName ?? "",
    quantity,
    quantityText: String(quantity),
    priceTier: item?.priceTier,
    unitPrice,
    unitPriceText: String(unitPrice),
    subtotal: quantity * unitPrice,
    cost: item?.cost,
    costText: item?.cost == null ? "" : String(item.cost),
  };
}

function numberFromText(value: string): number {
  return Math.max(0, parseAmount(value) ?? 0);
}

export function OrderForm({
  order,
  onDone,
  onCancel,
}: {
  order: Order;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const { state, activeStore, upsertOrder } = useStore();
  const toast = useToast();
  const isTiered = activeStore?.type === "inventory_tiered";
  const tiers = tiersForStore(activeStore);
  const defaultPriceTier = defaultTier(activeStore)?.id ?? tiers[0]?.id;
  const customers = activeStore ? customersForStore(state.customers, activeStore.id) : [];
  const products = activeStore ? state.products.filter((p) => p.storeId === activeStore.id) : [];
  const initialItems = orderItems(order);
  const [lines, setLines] = useState<DraftLine[]>(() =>
    initialItems.length ? initialItems.map(lineFromItem) : [lineFromItem()]
  );
  const [customerId, setCustomerId] = useState(order.customerId);
  const [customerQuery, setCustomerQuery] = useState(() => customers.find((c) => c.id === order.customerId)?.name ?? "");
  const [deposit, setDeposit] = useState(String(order.deposit ?? 0));
  const [promisedDate, setPromisedDate] = useState(order.promisedDate ?? "");
  const [orderStatus, setOrderStatus] = useState<OrderStatus>(effectiveOrderStatus(order));
  const [notes, setNotes] = useState(order.notes ?? "");
  const [newCustomerOpen, setNewCustomerOpen] = useState(false);

  const customerOptions = customers.map((customer) => ({
    value: customer.id,
    label: customer.name,
    detail: customer.phone ?? customer.instagram,
    keywords: [customer.phone, customer.instagram].filter(Boolean).join(" "),
  }));
  const productOptions = products.map((product) => {
    const price = isTiered ? product.prices?.[defaultPriceTier ?? ""] : product.price;
    return {
      value: product.id,
      label: product.name,
      detail: [
        price == null ? "Sin precio" : formatMoney(price),
        isTiered && typeof product.quantityOnHand === "number" ? `Existencia ${product.quantityOnHand}` : "",
      ].filter(Boolean).join(" · "),
      keywords: [product.sku, product.category].filter(Boolean).join(" "),
    };
  });
  const totals = useMemo(() => orderTotals({
    items: lines.map((line) => ({
      productId: line.productId,
      productName: line.productName,
      quantity: Math.max(0, Math.round(numberFromText(line.quantityText))),
      priceTier: line.priceTier,
      unitPrice: numberFromText(line.unitPriceText),
      subtotal: Math.max(0, Math.round(numberFromText(line.quantityText))) * numberFromText(line.unitPriceText),
      cost: line.cost,
    })),
    deposit: numberFromText(deposit),
  }), [deposit, lines]);

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function selectProduct(line: DraftLine, product: Product | undefined) {
    if (!product) {
      updateLine(line.key, { productId: undefined, productName: line.productQuery.trim(), productQuery: line.productQuery });
      return;
    }
    const priceTier = line.priceTier ?? defaultPriceTier;
    // A product whose default tier has no price keeps the line's current price
    // instead of silently dropping to $0 (mirrors changeTier's fallback).
    const unitPrice = (isTiered ? product.prices?.[priceTier ?? ""] : product.price) ?? numberFromText(line.unitPriceText);
    updateLine(line.key, {
      productId: product.id,
      productName: product.name,
      productQuery: product.name,
      priceTier: isTiered ? priceTier : undefined,
      unitPrice,
      unitPriceText: String(unitPrice),
      cost: product.cost,
      costText: product.cost == null ? "" : String(product.cost),
    });
  }

  function changeProductQuery(line: DraftLine, value: string) {
    const product = products.find((candidate) => candidate.name === value || candidate.id === value);
    if (product) selectProduct(line, product);
    else updateLine(line.key, { productId: undefined, productName: value, productQuery: value });
  }

  function changeTier(line: DraftLine, value: string) {
    const product = products.find((candidate) => candidate.id === line.productId);
    const unitPrice = product?.prices?.[value] ?? numberFromText(line.unitPriceText);
    updateLine(line.key, { priceTier: value, unitPrice, unitPriceText: String(unitPrice) });
  }

  async function submit() {
    if (!customerId) {
      toast.error("Elige un cliente para guardar el pedido.");
      return;
    }
    const normalizedItems: OrderItem[] = [];
    for (const line of lines) {
      const productName = line.productName.trim();
      const quantity = parseAmount(line.quantityText);
      const unitPrice = parseAmount(line.unitPriceText);
      if (!productName || !quantity || !Number.isInteger(quantity) || quantity <= 0) {
        toast.error("Cada línea necesita un nombre y una cantidad entera positiva.");
        return;
      }
      if (unitPrice == null || unitPrice < 0) {
        toast.error("Revisa los precios de las líneas.");
        return;
      }
      const cost = parseAmount(line.costText);
      // Persist the tier the SELECT showed (line.priceTier ?? default), so the
      // saved snapshot never disagrees with what was on screen.
      const tier = isTiered ? line.priceTier ?? defaultPriceTier : undefined;
      normalizedItems.push({
        ...(line.productId ? { productId: line.productId } : {}),
        productName,
        quantity,
        ...(tier ? { priceTier: tier } : {}),
        unitPrice,
        subtotal: quantity * unitPrice,
        ...(cost != null ? { cost } : {}),
      });
    }
    const paid = numberFromText(deposit);
    const next: Order = {
      id: order.id,
      storeId: order.storeId,
      customerId,
      items: normalizedItems,
      deposit: paid,
      orderStatus,
      paymentStatus: paymentStatusForOrder({ ...order, items: normalizedItems, deposit: paid }),
      ...(promisedDate ? { promisedDate } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      ...(order.source ? { source: order.source } : {}),
      ...(order.requesterName ? { requesterName: order.requesterName } : {}),
      schemaVersion: CURRENT_ORDER_SCHEMA_VERSION,
      createdAt: order.createdAt,
      updatedAt: new Date().toISOString(),
    };
    try {
      await upsertOrder(next);
      toast.success("Pedido guardado");
      onDone();
    } catch {
      toast.error("No se pudo guardar el pedido. Intenta de nuevo.");
    }
  }

  return (
    <div className="space-y-6 pb-8">
      <div className="space-y-2">
        <SearchSelect
          label="Cliente"
          placeholder="Busca por nombre o teléfono"
          value={customerQuery}
          options={customerOptions}
          onChange={(value) => {
            setCustomerQuery(value);
            // An exact, UNIQUE name in this store binds the client (typing the
            // full name is the natural flow); anything else clears the pick so
            // a duplicate name can never silently reassign the order.
            const matches = customers.filter((customer) => customer.name === value);
            setCustomerId(matches.length === 1 ? matches[0].id : "");
          }}
          onSelect={(option) => {
            const customer = customers.find((item) => item.id === option.value);
            if (!customer) return;
            setCustomerId(customer.id);
            setCustomerQuery(customer.name);
          }}
        />
        <Button variant="ghost" size="sm" onClick={() => setNewCustomerOpen(true)}>+ Nuevo cliente</Button>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="serif-display text-lg font-semibold text-ink">Productos</h2>
            <p className="text-xs text-on-surface-soft mt-0.5">Agrega una o varias líneas al pedido.</p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setLines((current) => [...current, lineFromItem()])}>+ Agregar línea</Button>
        </div>
        {lines.map((line, index) => {
          const currentQuantity = Math.max(0, Math.round(numberFromText(line.quantityText)));
          const currentPrice = numberFromText(line.unitPriceText);
          const selectedTier = tiers.find((tier) => tier.id === line.priceTier);
          const warning = selectedTier ? tierWarning({ quantity: currentQuantity, subtotal: currentQuantity * currentPrice }, selectedTier) : null;
          return (
            <Card key={line.key} className="space-y-4 p-4 md:p-5 shadow-none">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-on-surface-soft">Línea {index + 1}</span>
                {lines.length > 1 && (
                  <IconButton
                    variant="ghost"
                    aria-label={`Eliminar línea ${index + 1}`}
                    onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}
                    className="text-lg"
                  >
                    ×
                  </IconButton>
                )}
              </div>
              <SearchSelect
                label="Producto"
                placeholder="Busca o escribe un producto"
                value={line.productQuery}
                options={productOptions}
                emptyLabel="No aparece en el catálogo; puedes dejarlo como producto personalizado."
                onChange={(value) => changeProductQuery(line, value)}
                onSelect={(option) => {
                  const product = products.find((item) => item.id === option.value);
                  if (product) selectProduct(line, product);
                }}
              />
              {line.productId && <p className="text-xs text-on-surface-soft">Precio tomado del catálogo; puedes editarlo.</p>}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-[minmax(7rem,0.65fr)_minmax(10rem,1fr)_minmax(11rem,1fr)]">
                <TextField
                  label="Cantidad"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={line.quantityText}
                  onChange={(event) => {
                    const value = sanitizeIntegerInput(event.target.value);
                    updateLine(line.key, { quantityText: value, quantity: parseAmount(value) ?? 0 });
                  }}
                />
                <TextField
                  label="Precio unitario"
                  hint="Puedes ajustarlo para este pedido."
                  type="text"
                  inputMode="decimal"
                  pattern="[0-9]*[.]?[0-9]*"
                  value={line.unitPriceText}
                  onChange={(event) => {
                    const value = sanitizeDecimalInput(event.target.value);
                    updateLine(line.key, { unitPriceText: value, unitPrice: numberFromText(value) });
                  }}
                />
                {isTiered && (
                  <div className="col-span-2 md:col-span-1">
                    <SelectField
                      label="Nivel de precio"
                      hint="Se guarda en este pedido y no cambia el catálogo."
                      value={line.priceTier ?? defaultPriceTier ?? ""}
                      onChange={(value) => changeTier(line, value)}
                      options={tiers.map((tier) => ({ value: tier.id, label: tier.label }))}
                    />
                  </div>
                )}
                {!isTiered && <div className="hidden md:block" aria-hidden />}
              </div>
              <div className="grid grid-cols-2 items-end gap-3">
                <TextField
                  label="Costo (opcional)"
                  type="text"
                  inputMode="decimal"
                  pattern="[0-9]*[.]?[0-9]*"
                  value={line.costText}
                  onChange={(event) => {
                    const value = sanitizeDecimalInput(event.target.value);
                    updateLine(line.key, { costText: value, cost: parseAmount(value) });
                  }}
                />
                <div className="rounded-md bg-surface-muted px-3 py-2.5 min-h-[3.25rem] flex items-center">
                  <StatRow label="Subtotal"><Money amount={currentQuantity * currentPrice} /></StatRow>
                </div>
              </div>
              {warning && <Badge tone="warning">{warning}</Badge>}
            </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <TextField
          label="Anticipo"
          type="text"
          inputMode="decimal"
          pattern="[0-9]*[.]?[0-9]*"
          value={deposit}
          onChange={(event) => setDeposit(sanitizeDecimalInput(event.target.value))}
        />
        <TextField label="Fecha prometida" type="date" value={promisedDate} onChange={(event) => setPromisedDate(event.target.value)} />
      </div>
      <SelectField label="Estado del pedido" value={orderStatus} onChange={setOrderStatus} options={STATUS_OPTIONS} />
      <TextArea label="Notas" value={notes} onChange={(event) => setNotes(event.target.value)} />

      <div className="sticky bottom-3 z-10 rounded-xl border border-edge bg-paper/95 p-4 shadow-lift backdrop-blur">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <StatRow label="Piezas">{totals.pieces}</StatRow>
          <StatRow label="Total"><Money amount={totals.estimatedTotal} /></StatRow>
          <StatRow label="Anticipo"><Money amount={totals.paid} /></StatRow>
          <StatRow label="Saldo" tone={totals.balance > 0 ? "danger" : "success"}><Money amount={totals.balance} /></StatRow>
        </div>
        <div className="flex gap-2 mt-4">
          {onCancel && <Button variant="ghost" full onClick={onCancel}>Cancelar</Button>}
          <Button full size="lg" onClick={submit} disabled={!customerId || lines.length === 0}>Guardar pedido</Button>
        </div>
      </div>

      <Dialog open={newCustomerOpen} title="Nuevo cliente" onClose={() => setNewCustomerOpen(false)}>
        <CustomerForm
          customer={activeStore ? newCustomer(activeStore.id) : newCustomer(order.storeId)}
          onDone={() => setNewCustomerOpen(false)}
          onSaved={(customer) => {
            setCustomerId(customer.id);
            setCustomerQuery(customer.name);
          }}
        />
      </Dialog>
    </div>
  );
}
