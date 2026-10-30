import { Button, Card } from "../design-system";

export function StartupErrorScreen({
  title,
  message,
  onRetry,
  retryLabel = "Volver a intentar",
}: {
  title: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-app p-4 text-on-surface">
      <Card className="w-full max-w-xl space-y-4 p-5">
        <h1 className="serif-display text-2xl font-semibold">{title}</h1>
        <p role="alert" className="text-sm text-on-surface-soft">{message}</p>
        {onRetry && <Button full onClick={onRetry}>{retryLabel}</Button>}
      </Card>
    </main>
  );
}
