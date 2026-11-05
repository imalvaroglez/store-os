// Versioned release metadata — the single source for the panel footer and the
// pre-release guard. Newest first. A production release MUST bump the first
// entry (version + date + notes); scripts/check-release.cjs enforces it
// against what production already serves.
import raw from "./releases.json";

export interface ReleaseEntry {
  version: string;
  /** Intended release date, YYYY.MM.DD (es-MX style dots). */
  date: string;
  title: string;
  notes: string[];
}

export const RELEASES: ReleaseEntry[] = raw;

export const LATEST_RELEASE: ReleaseEntry = RELEASES[0];
