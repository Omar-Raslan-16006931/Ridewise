/** "1,240" for whole amounts, "59.50" when there are piastres. No currency code. */
export function egp(value: number): string {
  const n = Number.isFinite(value) ? value : 0;
  const whole = Math.abs(n - Math.round(n)) < 0.005;
  return new Intl.NumberFormat("en", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(whole ? Math.round(n) : n);
}

export function whole(value: number): string {
  return String(Math.round(value));
}

const dayFormatter = new Intl.DateTimeFormat("en", { weekday: "short", day: "numeric", month: "short" });
const timeFormatter = new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" });
const shortDateFormatter = new Intl.DateTimeFormat("en", { day: "numeric", month: "short" });

export const formatDay = (date: Date | string) => dayFormatter.format(new Date(date));
export const formatTime = (date: Date | string) => timeFormatter.format(new Date(date));
export const formatShortDate = (date: Date | string) => shortDateFormatter.format(new Date(date));

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
