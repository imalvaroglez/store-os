import { useState } from "react";
import { useStore } from "../../app/StoreProvider";
import { useAuth } from "../../app/firebase/AuthProvider";
import { STORE_TYPE_LABELS } from "../../lib/labels";
import { Button, Card, IconButton, ScreenHeader, Sheet } from "../../design-system";
import { StoreForm } from "./StoreForm";
import { StoreSettingsScreen } from "./StoreSettingsScreen";

// "¿Quién opera hoy?" — Netflix-style store picker (compact list layout).
// Shown right after sign-in when there's no active store. Also reachable via
// "Cambiar tienda" to switch.
export function StorePickerScreen() {
  const { state, setActiveStore } = useStore();
  const { user } = useAuth();
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState<string | null>(null);

  return (
    <div className="min-h-full">
      <div className="mx-auto max-w-md p-6 md:p-10">
        <ScreenHeader
          title="¿Quién opera hoy?"
          subtitle={user?.role === "super_admin" ? "Administrador — todas las tiendas" : "Elige una tienda para operar"}
        />

        <div className="space-y-2 mt-2">
          {state.stores.map((s) => (
            <div key={s.id} className="flex items-center gap-2">
              <Card
                onClick={() => setActiveStore(s.id)}
                className="flex-1 flex items-center gap-3"
              >
                <span className="h-9 w-9 rounded-lg bg-ink text-paper flex items-center justify-center serif-display text-base font-semibold shrink-0">
                  {s.name.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-ink truncate">{s.name}</div>
                  <div className="text-[10px] text-ink-soft uppercase tracking-wide">
                    {STORE_TYPE_LABELS[s.type]}
                  </div>
                </div>
              </Card>
              {user?.role === "super_admin" && (
                <IconButton
                  variant="ghost"
                  aria-label={`Administrar ${s.name}`}
                  onClick={() => setManaging(s.id)}
                >
                  ⚙
                </IconButton>
              )}
            </div>
          ))}
        </div>

        <Button
          full
          variant="secondary"
          className="mt-3"
          onClick={() => setCreating(true)}
        >
          + Nueva tienda
        </Button>
      </div>

      <Sheet open={creating} onClose={() => setCreating(false)} title="Nueva tienda">
        {/* StoreForm calls addStore internally, which makes the new store active,
            so Root leaves the picker automatically. */}
        <StoreForm onDone={() => setCreating(false)} />
      </Sheet>

      {managing && (
        <Sheet open onClose={() => setManaging(null)} title="Administrar tienda">
          <StoreSettingsScreen storeId={managing} onDone={() => setManaging(null)} />
        </Sheet>
      )}
    </div>
  );
}
