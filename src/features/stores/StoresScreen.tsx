import { useState } from "react";
import { useStore } from "../../app/StoreProvider";
import { Button, EmptyState, Sheet } from "../../design-system";
import { StoreForm } from "./StoreForm";

// First-run / no-store screen. Also the fallback if a user deletes down to zero.
export function StoresScreen() {
  const { resetDemo } = useStore();
  const [creating, setCreating] = useState(false);

  return (
    <div className="min-h-full flex flex-col">
      <EmptyState
        title="Crea tu primera tienda"
        subtitle="Empieza a llevar tu catálogo, pedidos y clientes en un solo lugar."
        action={
          <Button size="lg" onClick={() => setCreating(true)}>
            Crear tienda
          </Button>
        }
      />
      <div className="mt-auto pb-8 text-center">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (confirm("¿Cargar datos de ejemplo? Esto reinicia los datos actuales.")) {
              resetDemo();
            }
          }}
          className="underline"
        >
          Cargar datos de ejemplo
        </Button>
      </div>

      <Sheet open={creating} onClose={() => setCreating(false)} title="Nueva tienda">
        <StoreForm onDone={() => setCreating(false)} />
      </Sheet>
    </div>
  );
}
