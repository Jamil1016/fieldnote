import { describe, expect, it } from "vitest";
import { addDays, dayToMs, isDay, isWeekend, msToDay, WorkCalendar } from "./calendar";

// 2025-03-03 is a Monday.
const HOLIDAYS = ["2025-03-05", "2025-03-14"];
const cal = new WorkCalendar(HOLIDAYS);

describe("day helpers", () => {
  it("round-trips a day through milliseconds", () => {
    expect(msToDay(dayToMs("2025-03-03"))).toBe("2025-03-03");
  });

  it("adds days across a month boundary", () => {
    expect(addDays("2025-02-27", 3)).toBe("2025-03-02");
  });

  it("subtracts days across a year boundary", () => {
    expect(addDays("2025-01-01", -1)).toBe("2024-12-31");
  });

  it("handles the leap day", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
  });

  it.each([
    ["2025-03-01", true],
    ["2025-03-02", true],
    ["2025-03-03", false],
    ["2025-03-07", false],
  ])("isWeekend(%s) = %s", (day, expected) => {
    expect(isWeekend(day)).toBe(expected);
  });

  it.each([
    ["2025-03-03", true],
    ["2025-02-30", false],
    ["2025-3-3", false],
    ["not-a-day", false],
    ["", false],
  ])("isDay(%s) = %s", (value, expected) => {
    expect(isDay(value)).toBe(expected);
  });

  it("throws on an invalid day", () => {
    expect(() => dayToMs("nope")).toThrow();
  });
});

describe("WorkCalendar", () => {
  it("treats weekdays as working days", () => {
    expect(cal.isWorkingDay("2025-03-04")).toBe(true);
  });

  it("skips weekends", () => {
    expect(cal.isWorkingDay("2025-03-08")).toBe(false);
  });

  it("skips holidays", () => {
    expect(cal.isWorkingDay("2025-03-05")).toBe(false);
    expect(cal.isHoliday("2025-03-05")).toBe(true);
  });

  it("next working day jumps a holiday", () => {
    expect(cal.nextWorkingDay("2025-03-04")).toBe("2025-03-06");
  });

  it("next working day after Friday is Monday", () => {
    expect(cal.nextWorkingDay("2025-03-07")).toBe("2025-03-10");
  });

  it("next working day jumps a holiday Friday and the weekend", () => {
    expect(cal.nextWorkingDay("2025-03-13")).toBe("2025-03-17");
  });

  it("previous working day before Monday is Friday", () => {
    expect(cal.previousWorkingDay("2025-03-10")).toBe("2025-03-07");
  });

  it("previous working day jumps a holiday", () => {
    expect(cal.previousWorkingDay("2025-03-06")).toBe("2025-03-04");
  });

  it("lastWorkingDays returns the requested count, oldest first, excluding the anchor", () => {
    const days = cal.lastWorkingDays("2025-03-10", 4);
    expect(days).toEqual(["2025-03-03", "2025-03-04", "2025-03-06", "2025-03-07"]);
  });

  it("lastWorkingDays never includes a weekend or holiday", () => {
    for (const d of cal.lastWorkingDays("2025-04-01", 20)) expect(cal.isWorkingDay(d)).toBe(true);
  });

  it("workingDaysBetween is inclusive at both ends", () => {
    expect(cal.workingDaysBetween("2025-03-03", "2025-03-07")).toEqual([
      "2025-03-03",
      "2025-03-04",
      "2025-03-06",
      "2025-03-07",
    ]);
  });

  it("workingDaysBetween is empty for a reversed range", () => {
    expect(cal.workingDaysBetween("2025-03-07", "2025-03-03")).toEqual([]);
  });

  it("works with no holidays at all", () => {
    expect(new WorkCalendar().nextWorkingDay("2025-03-04")).toBe("2025-03-05");
  });
});
