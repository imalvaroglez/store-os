import { useState } from "react";
import { signInWithEmail as signIn, signUpWithEmail as signUp, signInWithGoogle } from "./auth";
import { Button, TextField, ScreenHeader } from "../../design-system";

// Email/password sign-in / sign-up + Google. Shown as a sheet from Settings or a
// standalone screen. Only the allowlisted platform emails (auth.ts:
// PLATFORM_ADMIN_EMAILS) become super_admin; every other signup is a member.
export function AuthScreen({ onDone }: { onDone?: () => void }) {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "in") await signIn(email.trim(), password);
      else await signUp(email.trim(), password);
      onDone?.();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setError(null);
    setBusy(true);
    try {
      await signInWithGoogle();
      onDone?.();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <ScreenHeader title={mode === "in" ? "Entrar" : "Crear cuenta"} subtitle="Sincroniza tus tiendas en la nube" />
      <form onSubmit={submit} className="space-y-4">
        <TextField
          label="Correo"
          type="email"
          autoComplete="email"
          placeholder="tu@correo.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
        />
        <TextField
          label="Contraseña"
          type="password"
          autoComplete={mode === "in" ? "current-password" : "new-password"}
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button full size="lg" disabled={busy || !email || !password}>
          {mode === "in" ? "Entrar" : "Crear cuenta"}
        </Button>
      </form>

      <div className="flex items-center gap-3 text-xs text-on-surface-soft">
        <div className="h-px bg-edge flex-1" />
        o
        <div className="h-px bg-edge flex-1" />
      </div>
      <Button full variant="secondary" onClick={google} disabled={busy}>
        Continuar con Google
      </Button>

      <Button full variant="ghost" onClick={() => setMode(mode === "in" ? "up" : "in")}>
        {mode === "in" ? "¿No tienes cuenta? Crear una" : "¿Ya tienes cuenta? Entrar"}
      </Button>
    </div>
  );
}

// Spanish, retryable messages for every sign-in failure (#481). Mapping lives
// here — next to the screen that shows it — so no explanatory message gets
// swallowed by a code-less Error thrown deeper in the flow.
function friendlyError(err: unknown): string {
  const code = (err as { code?: string })?.code ?? "";
  if (code.includes("email-already-in-use")) return "Ese correo ya está registrado. Intenta entrar.";
  if (code.includes("invalid-credential") || code.includes("wrong-password")) return "Correo o contraseña incorrectos.";
  if (code.includes("weak-password")) return "La contraseña debe tener al menos 6 caracteres.";
  if (code.includes("unauthorized-domain"))
    return "Este dominio no está autorizado para entrar con Google. Pide a la administración que lo agregue en Firebase Console → Authentication → Settings → Authorized domains.";
  if (code.includes("popup-blocked"))
    return "Tu navegador bloqueó la ventana de Google. Permite las ventanas emergentes y vuelve a intentar.";
  if (code.includes("network-request-failed"))
    return "No hubo conexión con Google. Revisa tu conexión e inténtalo de nuevo.";
  if (code.includes("popup-closed") || code.includes("cancelled-popup-request"))
    return "Se canceló el inicio con Google.";
  return "No se pudo completar. Intenta de nuevo.";
}
