// #184 — Gastos sueltos: register a real outlay in seconds ($15 without
// choosing a purchase), classify it, and associate it later — explicitly,
// with a preview before confirming. Supplies show their stash and consume
// in one tap. Mobile-first; every step explains itself in Spanish.
import { useMemo, useState } from "react";
import { useStore } from "../../app/StoreProvider";
import {
  Badge,
  Button,
  Card,
  CheckboxField,
  Dialog,
  EmptyState,
  Money,
  Screen,
  ScreenHeader,
  SelectField,
  Sheet,
  StatRow,
  TextField,
  useToast,
} from "../../design-system";
import { formatDate } from "../../lib/dates";
import { uid } from "../../lib/ids";
import { sanitizeMoneyInput, formatMoneyExact } from "../../lib/money";
import { orderAmountCents } from "../../lib/orderMoney";
import { effectivePurchaseStatus } from "../../types";
import {
  LOOSE_EXPENSE_CATEGORY_LABEL,
  type ExpenseAssignment,
  type LooseExpense,
  type LooseExpenseCategory,
  type Order,
  type Purchase,
} from "../../types";
import {
  pendingAssignmentCents,
  supplyChargeCents,
  planAllocation,
  supplyAvailableQuantity,
  supplyUnitCostCents,
} from "../../lib/expenses";

export function ExpensesScreen() {
  const { state, activeStore, saveExpense } = useStore();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<LooseExpense | null>(null);
  const [busy, setBusy] = useState(false);
  const [amountText, setAmountText] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<LooseExpenseCategory>("operation");
  const [quantityText, setQuantityText] = useState("");
  const [simplified, setSimplified] = useState(false);

  const expenses = useMemo(
    () => state.expenses.filter((expense) => expense.storeId === activeStore?.id).sort((a, b) => b.date.localeCompare(a.date)),
    [state.expenses, activeStore?.id]
  );

  function openCreate() {
    setEditing(null);
    setAmountText(""); setDescription(""); setQuantityText(""); setSimplified(false);
    setCategory("operation");
    setDate(new Date().toISOString().slice(0, 10));
    setOpen(true);
  }

  function openEdit(expense: LooseExpense) {
    setEditing(expense);
    setAmountText(String(expense.amount));
    setDate(expense.date);
    setDescription(expense.description ?? "");
    setCategory(expense.category);
    setQuantityText(expense.supply ? String(expense.supply.quantityInitial) : "");
    setSimplified(!!expense.simplifiedOperation);
    setOpen(true);
  }

  // #257: with assignments, consumptions or an existing stash the
  // classification is locked evidence — the controls reflect it instead of
  // accepting changes the save silently discards (adversarial finding C).
  const locked = !!editing && (
    (editing.assignments ?? []).length > 0 ||
    (editing.supply?.consumptions ?? []).length > 0 ||
    !!editing.supply
  );

  async function submit() {
    const amount = Number(amountText);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Captura un importe mayor que cero.");
      return;
    }
    // Adversarial finding B: a huge amount survives validation and later
    // breaks the list render (cents overflow) on every load — reject it here.
    if (amount > 10_000_000) {
      toast.error("El importe es demasiado grande para registrarlo.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      toast.error("La fecha del gasto no es válida.");
      return;
    }
    // #255/#257: units are only demanded when a consumable supply stash is
    // being decided here — simplified supplies skip them, an existing supply
    // keeps its original units (evidence), and a locked expense cannot
    // reclassify so it never decides a stash.
    const editingExistingSupply = !!(editing && editing.supply);
    if (category === "supplies" && !simplified && !editingExistingSupply && !locked) {
      const quantity = Math.round(Number(quantityText));
      if (!Number.isSafeInteger(quantity) || quantity < 1) {
        toast.error("Captura cuántas unidades compraste (p. ej. 100 bolsas).");
        return;
      }
    }
    if (editing) {
      // Classification edit: amount/date are evidence (immutable); category
      // changes only while nothing has been assigned or consumed (locked).
      setBusy(true);
      try {
        await saveExpense({
          ...editing,
          description: description.trim() || undefined,
          category: locked ? editing.category : category,
          // R1: the simplified treatment IS editable while nothing has been
          // assigned/consumed and there is no stash (locked otherwise).
          ...(locked ? {} : { simplifiedOperation: simplified ? true : undefined }),
          // #257: reclassifying into a consumable supply creates its stash
          // exactly once, with the units captured in this edit.
          ...(!locked && category === "supplies" && !simplified
            ? { supply: { quantityInitial: Math.round(Number(quantityText)), consumptions: [] } }
            : {}),
        });
        toast.success("Gasto actualizado.");
        setOpen(false);
        setEditing(null);
      } catch (error) {
        toast.error(error instanceof Error && error.message ? error.message : "No se pudo actualizar el gasto.");
      } finally {
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    try {
      await saveExpense({
        id: uid("exp"),
        storeId: activeStore!.id,
        amount,
        date,
        description: description.trim() || undefined,
        category,
        ...(category === "supplies" && !simplified
          ? { supply: { quantityInitial: Math.round(Number(quantityText)), consumptions: [] } }
          : {}),
        ...(simplified ? { simplifiedOperation: true } : {}),
        createdAt: "",
        updatedAt: "",
      });
      toast.success("Gasto registrado.");
      setOpen(false);
      setAmountText(""); setDescription(""); setQuantityText(""); setSimplified(false);
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : "No se pudo registrar el gasto.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <ScreenHeader
        title="Gastos"
        subtitle={`${expenses.length} ${expenses.length === 1 ? "gasto suelto" : "gastos sueltos"}`}
        action={<Button onClick={openCreate}>+ Agregar</Button>}
      />
      {expenses.length === 0 ? (
        <EmptyState
          title="Sin gastos sueltos"
          subtitle="Registra un desembolso real aunque aún no sepas a qué compra o pedido corresponde: lo clasificas y lo asignas después."
          icon={<div className="text-6xl">💸</div>}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {expenses.map((expense) => (
            <ExpenseCard key={expense.id} expense={expense} purchases={state.purchases} orders={state.orders} onEdit={openEdit} />
          ))}
        </div>
      )}

      <Sheet open={open} onClose={() => setOpen(false)} title={editing ? "Editar gasto" : "Agregar gasto"}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Importe" inputMode="decimal" placeholder="0.00" disabled={!!editing} value={amountText} onChange={(e) => setAmountText(sanitizeMoneyInput(e.target.value))} />
            <TextField label="Fecha" type="date" disabled={!!editing} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <TextField label="Descripción (opcional)" placeholder="p. ej. gasolina del viaje" value={description} onChange={(e) => setDescription(e.target.value)} />
          <SelectField
            label="Categoría"
            value={category}
            onChange={(next) => setCategory(next as LooseExpenseCategory)}
            disabled={locked}
            hint={locked ? "Con asignaciones, consumos o un stash activo la clasificación queda fija: es evidencia." : undefined}
            options={(Object.keys(LOOSE_EXPENSE_CATEGORY_LABEL) as LooseExpenseCategory[]).map((value) => ({ value, label: LOOSE_EXPENSE_CATEGORY_LABEL[value] }))}
          />
          {category === "supplies" && !simplified && (
            <TextField
              label="Unidades compradas"
              inputMode="numeric"
              disabled={!!editing && (!!editing.supply || locked)}
              placeholder="p. ej. 100 bolsas"
              value={quantityText}
              onChange={(e) => setQuantityText(e.target.value.replace(/[^0-9]/g, ""))}
              hint={amountText && Number(quantityText) > 0
                  ? (() => {
                      const total = Math.round(Number(amountText) * 100);
                      const units = Math.round(Number(quantityText));
                      if (units <= 0) return undefined;
                      const unitCost = Math.floor(total / units);
                      const remainder = total - unitCost * units;
                      return remainder > 0
                        ? `Costo por unidad: $${(unitCost / 100).toFixed(2)}–$${((unitCost + 1) / 100).toFixed(2)} (las primeras ${remainder} cargan un centavo más; el total siempre suma exacto)`
                        : `Costo por unidad: $${(unitCost / 100).toFixed(2)}`;
                    })()
                  : undefined}
            />
          )}
          <CheckboxField
            label="Tratamiento simplificado (gasto del periodo)"
            caption="Reconocer el importe en su periodo sin asociarlo a nada: no vuelve a contarse al vender."
            checked={simplified}
            onChange={setSimplified}
            disabled={locked}
          />
          <Button full disabled={busy} onClick={() => void submit()}>
            {busy ? "Guardando…" : "Guardar gasto"}
          </Button>
          <p className="text-xs text-on-surface-soft">
            Guardar no asigna nada: el saldo queda pendiente hasta que lo asocies explícitamente a una compra o pedido.
          </p>
        </div>
      </Sheet>
    </Screen>
  );
}

function ExpenseCard({ expense, purchases, orders, onEdit }: { expense: LooseExpense; purchases: Purchase[]; orders: Order[]; onEdit: (expense: LooseExpense) => void }) {
  const { assignExpense, consumeSupply, deleteExpense } = useStore();
  const toast = useToast();
  const [assignOpen, setAssignOpen] = useState(false);
  const [consumeOpen, setConsumeOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = pendingAssignmentCents(expense);
  const isSupply = !!expense.supply && !expense.simplifiedOperation;

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    try {
      await action();
      toast.success(success);
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : "No se pudo registrar. Intenta de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-ink truncate">{expense.description ?? LOOSE_EXPENSE_CATEGORY_LABEL[expense.category]}</h3>
          <p className="text-xs text-ink-soft">{formatDate(expense.date)} · {LOOSE_EXPENSE_CATEGORY_LABEL[expense.category]}</p>
        </div>
        <Badge tone={pending > 0 ? "warning" : "success"}>
          {expense.simplifiedOperation
            ? "Reconocido"
            : pending > 0
              ? `${isSupply ? "Por consumir" : "Pendiente"} ${formatMoneyExact(pending / 100)}`
              : isSupply ? "Consumido" : "Asignado"}
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <StatRow label="Importe"><Money exact amount={expense.amount} /></StatRow>
        {isSupply && (
          <StatRow label="Disponible">
            {supplyAvailableQuantity(expense)} × {formatMoneyExact(supplyUnitCostCents(expense) / 100)}
          </StatRow>
        )}
      </div>
      {(expense.assignments ?? []).length > 0 && (
        <ul className="text-xs text-ink-soft space-y-1">
          {(expense.assignments ?? []).map((assignment) => (
            <li key={assignment.id}>
              {formatMoneyExact(assignment.amountCents / 100)} → {assignment.target.kind === "purchase" ? "Compra" : "Pedido"} · {formatDate(assignment.at.slice(0, 10))}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        {pending > 0 && !isSupply && (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => setAssignOpen(true)}>Asignar</Button>
        )}
        {isSupply && supplyAvailableQuantity(expense) > 0 && (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => setConsumeOpen(true)}>Consumir</Button>
        )}
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onEdit(expense)}>Editar</Button>
        {(expense.assignments ?? []).length === 0 && (expense.supply?.consumptions ?? []).length === 0 && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => deleteExpense(expense.id), "Gasto eliminado.")}>Eliminar</Button>
        )}
      </div>
      {assignOpen && (
        <AssignSheet
          expense={expense}
          purchases={purchases}
          orders={orders}
          onClose={() => setAssignOpen(false)}
          onAssign={(assignment, purchaseExpense) =>
            run(() => assignExpense(expense, assignment, purchaseExpense).then(() => setAssignOpen(false)), "Asignación registrada.")
          }
        />
      )}
      {consumeOpen && (
        <ConsumeSheet
          expense={expense}
          orders={orders}
          onClose={() => setConsumeOpen(false)}
          onConsume={(consumption, description) =>
            run(() => consumeSupply(expense, consumption, description).then(() => setConsumeOpen(false)), "Consumo registrado.")
          }
        />
      )}
    </Card>
  );
}

function AssignSheet({ expense, purchases, orders, onClose, onAssign }: {
  expense: LooseExpense;
  purchases: Purchase[];
  orders: Order[];
  onClose: () => void;
  onAssign: (assignment: Omit<ExpenseAssignment, "at" | "by">, purchaseExpense?: { id: string; category: "sourcing_transport" | "other"; amount: number; description?: string }) => Promise<void>;
}) {
  const pending = pendingAssignmentCents(expense);
  // F8: legacy purchases without status are RECEIVED — the effective status
  // keeps only truly assignable purchases in the list.
  const openPurchases = purchases.filter(
    (purchase) => purchase.storeId === expense.storeId && effectivePurchaseStatus(purchase) !== "received"
  );
  // F7: newest orders first — the likely assignment targets.
  const storeOrders = orders
    .filter((order) => order.storeId === expense.storeId && order.orderStatus !== "cancelled")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const [kind, setKind] = useState<"purchase" | "order">(openPurchases.length > 0 ? "purchase" : "order");
  const [purchaseId, setPurchaseId] = useState(openPurchases[0]?.id ?? "");
  const [orderId, setOrderId] = useState(storeOrders[0]?.id ?? "");
  const [amountText, setAmountText] = useState((pending / 100).toString());
  const [mode, setMode] = useState<"units" | "value">("units");
  const [confirming, setConfirming] = useState(false);

  const targetLines = useMemo(() => {
    if (kind === "purchase") {
      const purchase = openPurchases.find((candidate) => candidate.id === purchaseId);
      return (purchase?.lines ?? []).map((line) => ({ lineId: line.lineId ?? "", name: line.name, quantity: line.quantity, unitPriceCents: orderAmountCents(line.unitCost ?? 0) }));
    }
    const order = storeOrders.find((candidate) => candidate.id === orderId);
    return (order?.items ?? []).map((item) => ({ lineId: item.lineId ?? "", name: item.productName, quantity: item.quantity, unitPriceCents: orderAmountCents(item.unitPrice) }));
  }, [kind, purchaseId, orderId, openPurchases, storeOrders]);

  const amountCents = Math.round(Number(amountText) * 100);
  const plan = mode === "units" || mode === "value" ? planAllocation(amountCents, targetLines, mode) : [];

  const valid = Number.isFinite(amountCents) && amountCents > 0 && amountCents <= pending
    && (kind === "purchase" ? !!purchaseId : !!orderId);

  return (
    <Sheet open onClose={onClose} title="Asignar gasto">
      <div className="space-y-4">
        <SelectField
          label="Destino"
          value={kind}
          onChange={(next) => setKind(next as "purchase" | "order")}
          options={[
            ...(openPurchases.length > 0 ? [{ value: "purchase", label: "Compra abierta (costo de inventario)" }] : []),
            { value: "order", label: "Pedido (gasto de venta)" },
          ]}
        />
        {kind === "purchase" ? (
          <SelectField
            label="Compra"
            value={purchaseId}
            onChange={setPurchaseId}
            options={openPurchases.map((purchase) => ({ value: purchase.id, label: purchase.name ?? purchase.id }))}
          />
        ) : (
          <SelectField
            label="Pedido"
            value={orderId}
            onChange={setOrderId}
            options={storeOrders.slice(0, 30).map((order) => ({
              value: order.id,
              label: `${order.customerName ?? "Pedido"} · ${formatDate(order.createdAt.slice(0, 10))}`,
            }))}
          />
        )}
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Importe a asignar" inputMode="decimal" value={amountText} onChange={(e) => setAmountText(sanitizeMoneyInput(e.target.value))} />
          {kind === "order" ? (
            <SelectField
              label="Reparto"
              value={mode}
              onChange={(next) => setMode(next as "units" | "value")}
              options={[
                { value: "units", label: "Por unidades" },
                { value: "value", label: "Por valor" },
              ]}
            />
          ) : (
            <p className="text-xs text-on-surface-soft">El costo se integra por piezas al recibir la mercancía.</p>
          )}
        </div>
        <p className="text-xs text-on-surface-soft">Pendiente de este gasto: <Money exact amount={pending / 100} /></p>
        {plan.length > 0 && (
          <div className="rounded-xl bg-surface p-3 ring-1 ring-edge text-xs space-y-1">
            <p className="font-semibold text-ink">Vista previa del reparto</p>
            {plan.map((row, index) => (
              <p key={row.lineId || `line-${index}`} className="flex justify-between gap-2">
                <span className="text-ink-soft truncate">{targetLines.find((line) => line.lineId === row.lineId)?.name ?? "Pieza"}</span>
                <span className="font-mono">{formatMoneyExact(row.amountCents / 100)}</span>
              </p>
            ))}
            <p className="text-ink-soft pt-1 border-t border-edge">Σ {formatMoneyExact(plan.reduce((sum, row) => sum + row.amountCents, 0) / 100)} — exacto al centavo.</p>
          </div>
        )}
        <Button full disabled={!valid || confirming} onClick={() => setConfirming(true)}>Asignar</Button>
      </div>
      <Dialog
        open={confirming}
        title="Confirmar asignación"
        onClose={() => setConfirming(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>Cancelar</Button>
            <Button onClick={() => {
              setConfirming(false);
              const target = kind === "purchase" ? { kind: "purchase" as const, purchaseId } : { kind: "order" as const, orderId };
              const purchaseExpense = kind === "purchase"
                ? { id: uid("pexp"), category: "sourcing_transport" as const, amount: amountCents / 100, description: expense.description }
                : undefined;
              void onAssign({ id: uid("asg"), target, mode, amountCents, allocations: plan.length ? plan : undefined }, purchaseExpense);
            }}>Confirmar</Button>
          </>
        }
      >
        <p className="text-sm text-on-surface-soft">
          Se asignan <Money exact amount={amountCents / 100} /> a {kind === "purchase" ? "la compra (costo de inventario)" : "el pedido (gasto de venta)"}.
          {kind === "purchase" ? " El reparto se integra al costo por pieza cuando recibas la mercancía." : " El pedido reduce su ganancia estimada; su venta y el saldo de la clienta no cambian."}
        </p>
      </Dialog>
    </Sheet>
  );
}

function ConsumeSheet({ expense, orders, onClose, onConsume }: {
  expense: LooseExpense;
  orders: Order[];
  onClose: () => void;
  onConsume: (consumption: { id: string; quantity: number; orderId?: string }, description?: string) => Promise<void>;
}) {
  const available = supplyAvailableQuantity(expense);
  const unit = supplyUnitCostCents(expense);
  // Estimate uses the SAME cumulative math as the transaction (the charge is
  // recomputed against the fresh document on save).
  const estimateCharge = (q: number) => supplyChargeCents({ id: "__estimate__", at: "", by: "", quantity: q }, expense);
  const storeOrders = orders.filter((order) => order.storeId === expense.storeId && order.orderStatus !== "cancelled");
  const [quantityText, setQuantityText] = useState("1");
  const [orderId, setOrderId] = useState("");
  const [confirming, setConfirming] = useState(false);
  const quantity = Math.round(Number(quantityText));
  const charge = quantity > 0 ? estimateCharge(quantity) : 0;
  const valid = Number.isSafeInteger(quantity) && quantity > 0 && quantity <= available;

  return (
    <Sheet open onClose={onClose} title="Consumir suministro">
      <div className="space-y-4">
        <p className="text-sm">Disponibles: <strong>{available}</strong> × {formatMoneyExact(unit / 100)}</p>
        <TextField
          label="Cantidad a consumir"
          inputMode="numeric"
          value={quantityText}
          onChange={(e) => setQuantityText(e.target.value.replace(/[^\d]/g, ""))}
          hint={quantity > 0 ? `Carga ${formatMoneyExact(estimateCharge(quantity) / 100)} al pedido que elijas.` : undefined}
        />
        <SelectField
          label="Pedido (opcional)"
          value={orderId}
          onChange={setOrderId}
          options={[{ value: "", label: "Sin pedido (uso interno)" }, ...storeOrders.slice(0, 30).map((order) => ({
            value: order.id,
            label: `${order.customerName ?? "Pedido"} · ${formatDate(order.createdAt.slice(0, 10))}`,
          }))]}
        />
        <Button full disabled={!valid || confirming} onClick={() => setConfirming(true)}>Consumir</Button>
      </div>
      <Dialog
        open={confirming}
        title="Confirmar consumo"
        onClose={() => setConfirming(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>Cancelar</Button>
            <Button onClick={() => {
              setConfirming(false);
              void onConsume({ id: uid("sup"), quantity, ...(orderId ? { orderId } : {}) }, expense.description);
            }}>Confirmar</Button>
          </>
        }
      >
        <p className="text-sm text-on-surface-soft">
          Salen <strong>{quantity}</strong> del suministro{orderId ? ` y el pedido carga ${formatMoneyExact(charge / 100)} como gasto de venta` : " (sin cargo a ningún pedido)"}.
        </p>
      </Dialog>
    </Sheet>
  );
}
