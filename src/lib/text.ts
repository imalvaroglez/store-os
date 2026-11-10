/** #219: the ONE loose text normalization — diacritics folded (NFD),
 * letters+digits only, es-MX lowercase. Shared by the search match pass
 * (#302) and duplicate-name detection so they can never drift. */
export function looseText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toLocaleLowerCase("es-MX");
}
