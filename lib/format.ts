/** Display formatting. Fixed locale and UTC so server and client render the same text. */

const DAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" });
const DAY_SHORT = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});
const TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });

export function fmtDay(day: string): string {
  return DAY.format(new Date(`${day}T00:00:00Z`));
}

export function fmtDayShort(day: string): string {
  return DAY_SHORT.format(new Date(`${day}T00:00:00Z`));
}

export function fmtDateTime(iso: string): string {
  return DATE_TIME.format(new Date(iso)).replace(",", "");
}

export function fmtTime(iso: string | number): string {
  return TIME.format(new Date(iso));
}

export function fmtHours(hours: number | null | undefined, digits = 2): string {
  if (hours === null || hours === undefined || !Number.isFinite(hours)) return "-";
  return hours.toFixed(digits);
}

export function fmtPct(ratio: number | null | undefined, digits = 1, signed = false): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return "-";
  const value = ratio * 100;
  const sign = signed && value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

export function fmtAge(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${Math.round(hours)} h`;
  return `${Math.round(hours / 24)} d`;
}

export const SHIFT_LABEL: Record<string, string> = {
  early: "Early (06:00)",
  day: "Day (08:00)",
  late: "Late (12:00)",
};

export const ARRANGEMENT_LABEL: Record<string, string> = {
  on_site: "On site",
  hybrid: "Hybrid",
  remote: "Remote",
};

export const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  on_leave: "On leave",
  inactive: "Inactive",
};
