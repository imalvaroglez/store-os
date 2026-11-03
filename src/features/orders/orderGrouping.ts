export type CategorySnapshot = { id: string; name: string };

/** Group in first-appearance order, keeping uncategorized lines last. */
export function groupOrderLines<T extends { categorySnapshot?: CategorySnapshot }>(lines: T[]): { name: string; lines: T[] }[] {
  const groups = new Map<string, { name: string; lines: T[] }>();
  const uncategorized: T[] = [];
  for (const line of lines) {
    const category = line.categorySnapshot;
    if (!category?.id || !category.name) {
      uncategorized.push(line);
      continue;
    }
    const group = groups.get(category.id) ?? { name: category.name, lines: [] };
    group.lines.push(line);
    groups.set(category.id, group);
  }
  return [...groups.values(), ...(uncategorized.length ? [{ name: "Sin categoría", lines: uncategorized }] : [])];
}
