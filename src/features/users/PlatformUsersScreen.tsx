import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { getFirebase } from "../../app/firebase/config";
import type { Role } from "../../app/firebase/auth";
import { Badge, Button, Card, EmptyState, Screen, ScreenHeader, SkeletonCard, TextField } from "../../design-system";

type PlatformUser = {
  uid: string;
  email: string | null;
  displayName: string | null;
  role: Role | null;
  createdAt: unknown;
};

type TimestampValue = { toDate?: () => Date };

export function formatPlatformUserDate(value: unknown): string {
  let date: Date | undefined;
  if (value instanceof Date) {
    date = value;
  } else if (typeof value === "string" || typeof value === "number") {
    date = new Date(value);
  } else if (value && typeof value === "object" && "toDate" in value) {
    const toDate = (value as TimestampValue).toDate;
    if (typeof toDate === "function") date = toDate.call(value);
  }
  if (!date || !Number.isFinite(date.getTime())) return "Sin fecha";
  return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export function PlatformUsersScreen({ userRole }: { userRole?: Role }) {
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let current = true;
    if (userRole !== "super_admin") {
      setUsers([]);
      setLoading(false);
      return () => { current = false; };
    }
    setLoading(true);
    setError(false);
    Promise.resolve().then(() => getDocs(collection(getFirebase().db, "users")))
      .then((snapshot) => {
        if (!current) return;
        const loaded = snapshot.docs.map((userDoc) => {
          const data = userDoc.data() as Record<string, unknown>;
          const role: Role | null = data.role === "super_admin" ? "super_admin" : data.role === "member" ? "member" : null;
          return {
            uid: userDoc.id,
            email: typeof data.email === "string" ? data.email : null,
            displayName: typeof data.displayName === "string" && data.displayName.trim() ? data.displayName : null,
            role,
            createdAt: data.createdAt,
          };
        }).sort((a, b) => (a.email ?? "").localeCompare(b.email ?? "", "es-MX"));
        setUsers(loaded);
      })
      .catch(() => { if (current) setError(true); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [userRole, retryKey]);

  const visibleUsers = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("es-MX");
    return users.filter((user) => !needle || (user.email ?? "").toLocaleLowerCase("es-MX").includes(needle));
  }, [users, query]);

  if (userRole !== "super_admin") {
    return <Screen><EmptyState title="No tienes permiso" subtitle="Solo la administración de la plataforma puede consultar esta lista." /></Screen>;
  }

  return (
    <Screen>
      <ScreenHeader
        title="Usuarios de la plataforma"
        subtitle={loading ? "Cargando usuarios…" : `${query.trim() ? visibleUsers.length : users.length} ${query.trim() ? "coincidencias" : users.length === 1 ? "usuario" : "usuarios"}`}
      />
      <div className="mb-5">
        <TextField label="Buscar usuarios" placeholder="Correo electrónico" value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>

      {loading ? <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">{Array.from({ length: 4 }, (_, index) => <SkeletonCard key={index} />)}</div>
        : error ? <EmptyState title="No se pudo cargar la lista" subtitle="Revisa tu conexión e intenta de nuevo." action={<Button variant="secondary" onClick={() => setRetryKey((key) => key + 1)}>Reintentar</Button>} />
          : visibleUsers.length === 0 ? <EmptyState title={users.length ? "No hay coincidencias" : "No hay usuarios"} subtitle={users.length ? "Prueba con otro correo electrónico." : "Aún no hay cuentas registradas en la plataforma."} icon={<div className="text-6xl" aria-hidden="true">👥</div>} />
            : <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {visibleUsers.map((user) => <div key={user.uid} data-testid="user-card"><Card className="min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate font-semibold text-ink">{user.displayName ?? user.email ?? "Sin correo"}</h2>
                    {user.displayName && <p className="mt-1 break-all text-sm text-ink-soft">{user.email ?? "Sin correo"}</p>}
                  </div>
                    <Badge tone={user.role === "super_admin" ? "accent" : "neutral"}>{user.role === "super_admin" ? "Administración" : user.role === "member" ? "Miembro" : "Sin rol"}</Badge>
                </div>
                  <p className="mt-2 text-xs text-ink-soft">ID de cuenta: {user.uid.slice(0, 8)}…</p>
                <p className="mt-3 text-xs text-ink-soft">Creada: {formatPlatformUserDate(user.createdAt)}</p>
              </Card></div>)}
            </div>}
    </Screen>
  );
}
