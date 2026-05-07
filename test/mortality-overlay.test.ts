import { describe, expect, it } from "vitest";
import {
  buildBaseline,
  computeMortalityFields,
  type MortalityBaseline,
} from "../src/tools/mortality-overlay.js";
import type { CalendarEvent } from "../src/types.js";
import { MortalityOverlayInput } from "../src/types.js";

const baseDates = {
  start_date: "2026-04-01T00:00:00Z",
  end_date: "2026-04-30T00:00:00Z",
};

// Default baseline numbers used as ground truth in the math tests.
const DEFAULT_TOTAL_WAKING_HOURS = 80 * 365 * 16; // 467200

describe("MortalityOverlayInput", () => {
  it("applies default expected_lifespan_years (80) and waking_hours_per_day (16)", () => {
    const out = MortalityOverlayInput.parse(baseDates);
    expect(out.expected_lifespan_years).toBe(80);
    expect(out.waking_hours_per_day).toBe(16);
  });

  it("requires start_date and end_date as ISO strings", () => {
    expect(() =>
      MortalityOverlayInput.parse({ start_date: "nope", end_date: baseDates.end_date }),
    ).toThrow();
  });

  it("rejects end_date <= start_date", () => {
    expect(() =>
      MortalityOverlayInput.parse({
        start_date: "2026-04-30T00:00:00Z",
        end_date: "2026-04-01T00:00:00Z",
      }),
    ).toThrow();
  });

  it("accepts expected_lifespan_years at the upper bound (150)", () => {
    expect(() =>
      MortalityOverlayInput.parse({ ...baseDates, expected_lifespan_years: 150 }),
    ).not.toThrow();
  });

  it("rejects expected_lifespan_years above 150", () => {
    expect(() =>
      MortalityOverlayInput.parse({ ...baseDates, expected_lifespan_years: 151 }),
    ).toThrow();
  });

  it("rejects negative expected_lifespan_years", () => {
    expect(() =>
      MortalityOverlayInput.parse({ ...baseDates, expected_lifespan_years: -1 }),
    ).toThrow();
  });

  it("rejects waking_hours_per_day above 24 or below 1", () => {
    expect(() => MortalityOverlayInput.parse({ ...baseDates, waking_hours_per_day: 25 })).toThrow();
    expect(() => MortalityOverlayInput.parse({ ...baseDates, waking_hours_per_day: 0 })).toThrow();
  });

  it("rejects more than 20 calendars and entries longer than 256 chars", () => {
    expect(() =>
      MortalityOverlayInput.parse({
        ...baseDates,
        calendars: Array.from({ length: 21 }, (_, i) => `cal-${i}`),
      }),
    ).toThrow();
    expect(() =>
      MortalityOverlayInput.parse({ ...baseDates, calendars: ["x".repeat(257)] }),
    ).toThrow();
  });

  it("accepts an optional birth_date", () => {
    const out = MortalityOverlayInput.parse({ ...baseDates, birth_date: "2003-05-07" });
    expect(out.birth_date).toBe("2003-05-07");
  });
});

describe("computeMortalityFields math", () => {
  const baseline: MortalityBaseline = {
    expected_lifespan_years: 80,
    waking_hours_per_day: 16,
    total_waking_hours: DEFAULT_TOTAL_WAKING_HOURS,
  };

  function evt(start: string, end: string, overrides: Partial<CalendarEvent> = {}): CalendarEvent {
    return {
      id: `${start}-${end}`,
      title: "x",
      start,
      end,
      all_day: false,
      calendar_name: "Work",
      ...overrides,
    };
  }

  it("30-min event yields ~0.0001% (decimal ~1.07e-6)", () => {
    const { events } = computeMortalityFields(
      [evt("2026-04-01T09:00:00Z", "2026-04-01T09:30:00Z")],
      baseline,
    );
    expect(events[0]?.duration_hours).toBeCloseTo(0.5, 10);
    expect(events[0]?.life_percent_consumed).toBeCloseTo(0.5 / DEFAULT_TOTAL_WAKING_HOURS, 12);
    expect(events[0]?.life_percent_consumed).toBeCloseTo(1.07e-6, 8);
  });

  it("1h event yields ~2.14e-6 (~0.0002%)", () => {
    const { events } = computeMortalityFields(
      [evt("2026-04-01T09:00:00Z", "2026-04-01T10:00:00Z")],
      baseline,
    );
    expect(events[0]?.life_percent_consumed).toBeCloseTo(1 / DEFAULT_TOTAL_WAKING_HOURS, 12);
  });

  it("8h event yields ~1.71e-5 (~0.0017%)", () => {
    const { events } = computeMortalityFields(
      [evt("2026-04-01T09:00:00Z", "2026-04-01T17:00:00Z")],
      baseline,
    );
    expect(events[0]?.life_percent_consumed).toBeCloseTo(8 / DEFAULT_TOTAL_WAKING_HOURS, 12);
  });

  it("cumulative running sum is correct across chronologically sorted events", () => {
    // Pass in reverse order to also confirm internal sort.
    const input = [
      evt("2026-04-03T10:00:00Z", "2026-04-03T11:00:00Z"), // 1h
      evt("2026-04-01T10:00:00Z", "2026-04-01T10:30:00Z"), // 0.5h
      evt("2026-04-02T10:00:00Z", "2026-04-02T18:00:00Z"), // 8h
    ];
    const { events, totals } = computeMortalityFields(input, baseline);
    expect(events.map((e) => e.duration_hours)).toEqual([0.5, 8, 1]);
    expect(events[0]?.life_percent_consumed_cumulative).toBeCloseTo(
      0.5 / DEFAULT_TOTAL_WAKING_HOURS,
      12,
    );
    expect(events[1]?.life_percent_consumed_cumulative).toBeCloseTo(
      8.5 / DEFAULT_TOTAL_WAKING_HOURS,
      12,
    );
    expect(events[2]?.life_percent_consumed_cumulative).toBeCloseTo(
      9.5 / DEFAULT_TOTAL_WAKING_HOURS,
      12,
    );
    expect(totals.event_count).toBe(3);
    expect(totals.total_hours).toBeCloseTo(9.5, 10);
    expect(totals.total_life_percent).toBeCloseTo(9.5 / DEFAULT_TOTAL_WAKING_HOURS, 12);
  });

  it("all-day event yields duration_hours=0 and life_percent_consumed=0 but stays in output", () => {
    const { events } = computeMortalityFields(
      [
        evt("2026-04-01T00:00:00Z", "2026-04-02T00:00:00Z", { all_day: true, id: "ad" }),
        evt("2026-04-01T09:00:00Z", "2026-04-01T10:00:00Z", { id: "timed" }),
      ],
      baseline,
    );
    expect(events).toHaveLength(2);
    const allDay = events.find((e) => e.id === "ad");
    expect(allDay?.duration_hours).toBe(0);
    expect(allDay?.life_percent_consumed).toBe(0);
  });

  it("with birth_date, ~23-year-old user, 1h event in 2026 → pct_of_remaining_life ≈ 1/332880", () => {
    const { events } = computeMortalityFields(
      [evt("2026-05-07T09:00:00Z", "2026-05-07T10:00:00Z")],
      baseline,
      { birthDate: "2003-05-07" },
    );
    // 23 years past birth → 57 years remaining → 332880 waking hours
    expect(events[0]?.pct_of_remaining_life).toBeCloseTo(1 / 332880, 8);
    expect(events[0]?.pct_of_remaining_life).toBeCloseTo(3.0e-6, 7);
  });

  it("event past expected end yields pct_of_remaining_life === 0 (no NaN/Infinity)", () => {
    const { events, totals } = computeMortalityFields(
      [evt("2090-05-07T09:00:00Z", "2090-05-07T10:00:00Z")],
      baseline,
      { birthDate: "2003-05-07" },
    );
    expect(events[0]?.pct_of_remaining_life).toBe(0);
    expect(Number.isFinite(events[0]?.pct_of_remaining_life ?? 0)).toBe(true);
    expect(totals.total_pct_of_remaining_life).toBe(0);
  });

  it("totals.total_pct_of_remaining_life is omitted when birth_date is not provided", () => {
    const { totals } = computeMortalityFields(
      [evt("2026-04-01T09:00:00Z", "2026-04-01T10:00:00Z")],
      baseline,
    );
    expect(totals.total_pct_of_remaining_life).toBeUndefined();
  });
});

describe("buildBaseline", () => {
  it("computes total_waking_hours = years * 365 * waking_hours_per_day", () => {
    const out = buildBaseline({
      ...baseDates,
      expected_lifespan_years: 80,
      waking_hours_per_day: 16,
    } as ReturnType<typeof MortalityOverlayInput.parse>);
    expect(out.total_waking_hours).toBe(467200);
  });

  it("echoes birth_date when provided", () => {
    const out = buildBaseline({
      ...baseDates,
      expected_lifespan_years: 80,
      waking_hours_per_day: 16,
      birth_date: "2003-05-07",
    } as ReturnType<typeof MortalityOverlayInput.parse>);
    expect(out.birth_date).toBe("2003-05-07");
  });
});
