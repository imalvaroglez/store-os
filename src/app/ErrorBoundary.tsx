import { Component, type ReactNode } from "react";

// Catches render-time errors (e.g. a Firebase misconfig, a bad route) so the app
// shows a friendly recovery screen instead of a white screen. Critical for real
// users on a deployed build.
type State = { error: Error | null };

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
    console.error("Store OS crashed:", error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-full flex flex-col items-center justify-center p-8 text-center">
          <div className="text-5xl mb-4">😵</div>
          <h1 className="serif-display text-2xl font-semibold text-ink mb-2">
            Algo salió mal
          </h1>
          <p className="text-sm text-ink-soft max-w-sm mb-6">
            Store OS tuvo un problema. Recarga la página; si persiste, revisa tu
            conexión o contáctanos.
          </p>
          <button
            onClick={() => {
              this.setState({ error: null });
              window.location.reload();
            }}
            className="rounded-xl bg-ink text-paper px-5 py-3 font-semibold"
          >
            Recargar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
