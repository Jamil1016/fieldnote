/**
 * Working-day calendar. Days are 'YYYY-MM-DD' strings interpreted in UTC (the
 * demo company runs on UTC). Pure: the holiday list is passed in.
 */
export type Day = string;

const DAY_MS = 86_400_000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDay(value: string): value is Day {
  if (!DAY_RE.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

export function dayToMs(day: Day): number {
  const ms = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(ms)) throw new Error(`Invalid day: ${day}`);
  return ms;
}

export function msToDay(ms: number): Day {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(day: Day, n: number): Day {
  return msToDay(dayToMs(day) + n * DAY_MS);
}

export function isWeekend(day: Day): boolean {
  const dow = new Date(dayToMs(day)).getUTCDay();
  return dow === 0 || dow === 6;
}

export class WorkCalendar {
  private readonly holidays: ReadonlySet<Day>;

  constructor(holidays: Iterable<Day> = []) {
    this.holidays = new Set(holidays);
  }

  isHoliday(day: Day): boolean {
    return this.holidays.has(day);
  }

  isWorkingDay(day: Day): boolean {
    return !isWeekend(day) && !this.holidays.has(day);
  }

  nextWorkingDay(day: Day): Day {
    let d = addDays(day, 1);
    while (!this.isWorkingDay(d)) d = addDays(d, 1);
    return d;
  }

  previousWorkingDay(day: Day): Day {
    let d = addDays(day, -1);
    while (!this.isWorkingDay(d)) d = addDays(d, -1);
    return d;
  }

  /** The last `count` working days strictly before `before`, oldest first. */
  lastWorkingDays(before: Day, count: number): Day[] {
    const out: Day[] = [];
    let d = before;
    while (out.length < count) {
      d = this.previousWorkingDay(d);
      out.push(d);
    }
    return out.reverse();
  }

  /** Working days in [from, to], inclusive, oldest first. */
  workingDaysBetween(from: Day, to: Day): Day[] {
    const out: Day[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      if (this.isWorkingDay(d)) out.push(d);
    }
    return out;
  }
}
