/** Fold accents and case for catalog search — a clienta (or Fer) types
 * "aros" and finds "Áros"; keys and names share one needle. */
export function normalizeCatalogText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-MX");
}
