import { useState } from "react";
import { Button, Sheet } from "../design-system";
import { LATEST_RELEASE, RELEASES } from "../releases/notes";

// Build identity (vite define). "dev" outside a production build (vitest, npm
// run dev) so the footer always renders something honest.
const BUILD_SHA = typeof __BUILD_SHA__ !== "undefined" ? __BUILD_SHA__ : "dev";
const BUILD_DATE = typeof __BUILD_DATE__ !== "undefined" ? __BUILD_DATE__ : "";

/**
 * Panel footer with the running version (#179). Answers "¿producción ya sirve
 * la versión nueva?" without asking anyone: the tuple comes from the versioned
 * release metadata (same commit), and the build SHA confirms the artifact.
 * Opens the release notes inside the app — never a link to GitHub.
 */
export function VersionFooter() {
  const [open, setOpen] = useState(false);
  const versionLabel = `${LATEST_RELEASE.version} (${LATEST_RELEASE.date})`;
  return (
    <footer className="border-t border-rule/60 px-4 pt-2 pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-3 flex items-center justify-between gap-3">
      <Button
        variant="ghost"
        size="sm"
        className="!px-2 text-xs text-on-surface-soft"
        onClick={() => setOpen(true)}
        aria-label={`Versión ${versionLabel}: ver notas de versión`}
      >
        {versionLabel}
      </Button>
      <span
        className="text-xs text-on-surface-soft/60 font-mono"
        title={`Compilación ${BUILD_SHA}${BUILD_DATE ? ` · ${BUILD_DATE}` : ""}`}
      >
        {BUILD_SHA}
      </span>
      <Sheet open={open} onClose={() => setOpen(false)} title="Notas de versión">
        <div className="space-y-5">
          {RELEASES.map((release, i) => (
            <section key={release.version} className="space-y-1">
              <h3 className="text-sm font-semibold text-on-surface">
                {release.version} ({release.date}){i === 0 ? " · actual" : ""}
              </h3>
              <p className="text-sm text-on-surface-soft">{release.title}</p>
              <ul className="list-disc pl-5 space-y-1">
                {release.notes.map((note) => (
                  <li key={note} className="text-sm text-on-surface">
                    {note}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </Sheet>
    </footer>
  );
}
