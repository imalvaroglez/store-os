// #336: Fer arrives at the contribution simulator FROM Estrategia's band
// tables; retyping the band there was the manual recapture the issue approved
// avoiding. A per-band "Simular" leaves this session-scoped prefill (one
// shot) so the simulator opens already scoped to that category and cost
// range. Nothing is persisted (preferences-only policy).

export type BandSimulatorPrefill = {
  categoryId: string;
  min: number;
  max: number | null;
};

let prefill: BandSimulatorPrefill | null = null;

export function setBandSimulatorPrefill(next: BandSimulatorPrefill): void {
  prefill = next;
}

/** Consume the prefill once, if any. */
export function takeBandSimulatorPrefill(): BandSimulatorPrefill | null {
  const taken = prefill;
  prefill = null;
  return taken;
}

/** Test seam. */
export function resetBandSimulatorPrefillForTests(): void {
  prefill = null;
}
