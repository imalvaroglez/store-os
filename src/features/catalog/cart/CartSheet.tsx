import { useState } from "react";
import { Button, Money, Sheet, TextField } from "../../../design-system";
import { createCartCheckoutUrl } from "../../../lib/whatsapp";
import type { CartItem } from "./useCart";

// Public checkout sheet: quantities → name + WhatsApp → submit (creates the
// order in the store via the submitPublicOrder callable) → WhatsApp confirm.
// Inline errors/no toasts: the public catalog renders outside the admin
// ToastProvider.

export function CartSheet({
  open,
  onClose,
  whatsappPhone,
  items,
  total,
  setQty,
  remove,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  whatsappPhone?: string | null;
  items: CartItem[];
  total: number;
  setQty: (productSlug: string, quantity: number) => void;
  remove: (productSlug: string) => void;
  // Creates the order (callable). Resolves on success; rejects with a
  // user-facing Spanish message. The parent clears the cart on success.
  onSubmit: (name: string, phone: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ name: string; items: CartItem[]; total: number } | null>(null);

  const nameOk = name.trim().length > 0;
  const phoneOk = /^\+?\d{10,15}$/.test(phone.replace(/\s|-/g, ""));

  async function submit() {
    setError(null);
    setSending(true);
    try {
      await onSubmit(name.trim(), phone.replace(/\s|-/g, ""));
      setDone({ name: name.trim(), items, total });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo enviar tu pedido, intenta de nuevo.");
    } finally {
      setSending(false);
    }
  }

  function close() {
    setDone(null);
    setError(null);
    onClose();
  }

  return (
    <Sheet open={open} onClose={close} title={done ? "¡Pedido enviado!" : "Tu pedido"}>
      {done ? (
        <div className="space-y-4">
          <p className="text-sm text-ink-soft">
            Tu pedido llegó a la tienda. Confírmalo por WhatsApp para que te respondan rápido.
          </p>
          <a href={createCartCheckoutUrl(whatsappPhone, done.name, done.items, done.total)} target="_blank" rel="noreferrer">
            <Button full size="lg">Confirmar por WhatsApp</Button>
          </a>
          <Button full variant="ghost" onClick={close}>
            Seguir viendo el catálogo
          </Button>
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-ink-soft">Tu carrito está vacío.</p>
      ) : (
        <div className="space-y-4">
          <ul className="divide-y divide-rule">
            {items.map((i) => (
              <li key={i.productSlug} className="py-3 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink truncate">{i.name}</p>
                  <p className="text-xs text-ink-soft">
                    <Money amount={i.price} /> c/u · <Money amount={i.price * i.quantity} />
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Quitar una pieza de ${i.name}`}
                    onClick={() => setQty(i.productSlug, i.quantity - 1)}
                  >
                    −
                  </Button>
                  <span className="w-6 text-center text-sm font-semibold text-ink">{i.quantity}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Agregar una pieza de ${i.name}`}
                    disabled={i.availableQuantity != null && i.quantity >= i.availableQuantity}
                    onClick={() => setQty(i.productSlug, i.quantity + 1)}
                  >
                    +
                  </Button>
                  <Button variant="ghost" size="sm" aria-label={`Quitar ${i.name} del carrito`} onClick={() => remove(i.productSlug)}>
                    🗑
                  </Button>
                </div>
              </li>
            ))}
          </ul>

          <div className="flex items-center justify-between text-sm font-semibold text-ink">
            <span>Total</span>
            <Money amount={total} />
          </div>

          <TextField
            label="Tu nombre"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="¿Cómo te llamas?"
          />
          <TextField
            label="Tu WhatsApp"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="10 dígitos, ej. 5512345678"
            hint="Para que la tienda te confirme el pedido."
          />

          {error && <p className="text-sm text-danger">{error}</p>}

          <Button
            full
            size="lg"
            disabled={!nameOk || !phoneOk || sending}
            onClick={submit}
          >
            {sending ? "Enviando…" : "Enviar pedido"}
          </Button>
        </div>
      )}
    </Sheet>
  );
}
