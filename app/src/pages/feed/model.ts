/** Pure presentation helpers recovered from the live feed. */
export function formatMeasurement(value: number, unit: string): string {
  return `${Number.isInteger(value) ? value : value.toFixed(unit === "s" ? 2 : 1)}${unit ? ` ${unit}` : ""}`;
}

/** Newer page data replaces an existing card while keeping its original position. */
export function mergeActivities<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  return [...new Map([...existing, ...incoming].map(activity => [activity.id, activity])).values()];
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("");
}

export function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(timestamp);
}
