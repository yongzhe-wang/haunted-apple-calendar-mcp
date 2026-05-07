import { describe, expect, it } from "vitest";
import {
  buildTimePerCalendarScript,
  computeBuckets,
  parseTimePerCalendarOutput,
} from "../src/tools/time-per-calendar.js";
import { DEFAULT_EXCLUDED_CALENDARS, TimePerCalendarInput } from "../src/types.js";

const RS = "\x1e";
const US = "\x1f";

describe("TimePerCalendarInput schema", () => {
  it("requires start_date and end_date", () => {
    expect(() => TimePerCalendarInput.parse({})).toThrow();
    expect(() => TimePerCalendarInput.parse({ start_date: "2026-01-01" })).toThrow();
  });

  it("rejects end_date <= start_date", () => {
    expect(() =>
      TimePerCalendarInput.parse({
        start_date: "2026-01-02T00:00:00Z",
        end_date: "2026-01-01T00:00:00Z",
      }),
    ).toThrow();
    expect(() =>
      TimePerCalendarInput.parse({
        start_date: "2026-01-01T00:00:00Z",
        end_date: "2026-01-01T00:00:00Z",
      }),
    ).toThrow();
  });

  it("defaults skip_allday to true", () => {
    const out = TimePerCalendarInput.parse({
      start_date: "2026-01-01T00:00:00Z",
      end_date: "2026-01-02T00:00:00Z",
    });
    expect(out.skip_allday).toBe(true);
  });

  it("accepts a custom exclude_calendars list", () => {
    const out = TimePerCalendarInput.parse({
      start_date: "2026-01-01T00:00:00Z",
      end_date: "2026-01-02T00:00:00Z",
      exclude_calendars: ["X", "Y"],
    });
    expect(out.exclude_calendars).toEqual(["X", "Y"]);
  });
});

describe("buildTimePerCalendarScript", () => {
  it("emits an AppleScript that loops calendars and accumulates durations", () => {
    const script = buildTimePerCalendarScript({
      start_date: "2026-01-01T00:00:00Z",
      end_date: "2026-01-31T23:59:59Z",
      skip_allday: true,
    });
    expect(script).toContain('tell application "Calendar"');
    expect(script).toContain("repeat with cal in calendars");
    expect(script).toContain("set timedSeconds to 0");
    expect(script).toContain("set alldayCount to alldayCount + 1");
    expect(script).toContain("set timedCount to timedCount + 1");
    // All defaults must be present in the excluded list literal.
    for (const name of DEFAULT_EXCLUDED_CALENDARS) {
      expect(script).toContain(name);
    }
  });

  it("escapes adversarial calendar names in exclude list", () => {
    const evil = '"; do shell script "rm -rf /"; --';
    const script = buildTimePerCalendarScript({
      start_date: "2026-01-01T00:00:00Z",
      end_date: "2026-01-31T23:59:59Z",
      exclude_calendars: ['Evil"', "back\\slash", evil, "$HOME"],
      skip_allday: true,
    });
    // Quotes and backslashes must be escaped.
    expect(script).toContain('\\"');
    expect(script).toContain("\\\\slash");
    // The injection payload must NOT appear in raw form (i.e. with an
    // unescaped closing quote that would let the rest run as AppleScript).
    expect(script).not.toContain(`"${evil}"`);
    // `$` is not an AppleScript metacharacter, but it should still pass through as a literal.
    expect(script).toContain("$HOME");
  });

  it("uses an empty excluded list when the caller passes []", () => {
    const script = buildTimePerCalendarScript({
      start_date: "2026-01-01T00:00:00Z",
      end_date: "2026-01-02T00:00:00Z",
      exclude_calendars: [],
      skip_allday: true,
    });
    expect(script).toContain("set excluded to {}");
  });
});

describe("parseTimePerCalendarOutput", () => {
  it("returns [] for empty input", () => {
    expect(parseTimePerCalendarOutput("")).toEqual([]);
  });

  it("parses a single calendar", () => {
    const raw = ["Work", "3600", "2", "0"].join(US) + RS;
    const out = parseTimePerCalendarOutput(raw);
    expect(out).toEqual([
      { name: "Work", timed_seconds: 3600, timed_event_count: 2, allday_event_count: 0 },
    ]);
  });

  it("parses multiple calendars", () => {
    const raw = ["Work", "7200", "3", "0"].join(US) + RS + ["Home", "1800", "1", "2"].join(US) + RS;
    const out = parseTimePerCalendarOutput(raw);
    expect(out).toHaveLength(2);
    expect(out[0]?.name).toBe("Work");
    expect(out[1]?.allday_event_count).toBe(2);
  });

  it("parses an all-day-only calendar", () => {
    const raw = ["Birthdays", "0", "0", "5"].join(US) + RS;
    const out = parseTimePerCalendarOutput(raw);
    expect(out[0]?.timed_seconds).toBe(0);
    expect(out[0]?.allday_event_count).toBe(5);
  });

  it("clamps malformed numeric fields to 0", () => {
    const raw = ["Bad", "not-a-number", "x", ""].join(US) + RS;
    const out = parseTimePerCalendarOutput(raw);
    expect(out[0]).toEqual({
      name: "Bad",
      timed_seconds: 0,
      timed_event_count: 0,
      allday_event_count: 0,
    });
  });
});

describe("computeBuckets", () => {
  it("computes pct_of_window and totals", () => {
    const windowSeconds = 10_000;
    const raw = [
      { name: "A", timed_seconds: 4000, timed_event_count: 2, allday_event_count: 0 },
      { name: "B", timed_seconds: 1000, timed_event_count: 1, allday_event_count: 0 },
    ];
    const { calendars, totals } = computeBuckets(raw, windowSeconds, true);
    expect(calendars).toHaveLength(2);
    expect(calendars[0]?.name).toBe("A");
    expect(calendars[0]?.pct_of_window).toBeCloseTo(0.4);
    expect(calendars[1]?.pct_of_window).toBeCloseTo(0.1);
    expect(totals.timed_seconds).toBe(5000);
    expect(totals.timed_event_count).toBe(3);
    expect(totals.pct_of_window).toBeCloseTo(0.5);
  });

  it("sorts calendars by timed_seconds descending", () => {
    const raw = [
      { name: "small", timed_seconds: 100, timed_event_count: 1, allday_event_count: 0 },
      { name: "big", timed_seconds: 9000, timed_event_count: 5, allday_event_count: 0 },
      { name: "mid", timed_seconds: 2000, timed_event_count: 2, allday_event_count: 0 },
    ];
    const { calendars } = computeBuckets(raw, 10_000, true);
    expect(calendars.map((c) => c.name)).toEqual(["big", "mid", "small"]);
  });

  it("zeros allday counts when skip_allday is true", () => {
    const raw = [{ name: "A", timed_seconds: 100, timed_event_count: 1, allday_event_count: 7 }];
    const { calendars, totals } = computeBuckets(raw, 1000, true);
    expect(calendars[0]?.allday_event_count).toBe(0);
    expect(totals.allday_event_count).toBe(0);
  });

  it("preserves allday counts when skip_allday is false", () => {
    const raw = [{ name: "A", timed_seconds: 0, timed_event_count: 0, allday_event_count: 4 }];
    const { calendars, totals } = computeBuckets(raw, 1000, false);
    expect(calendars).toHaveLength(1);
    expect(calendars[0]?.allday_event_count).toBe(4);
    expect(totals.allday_event_count).toBe(4);
  });

  it("returns 0 pct_of_window when windowSeconds is 0", () => {
    const raw = [{ name: "A", timed_seconds: 100, timed_event_count: 1, allday_event_count: 0 }];
    const { calendars, totals } = computeBuckets(raw, 0, true);
    expect(calendars[0]?.pct_of_window).toBe(0);
    expect(totals.pct_of_window).toBe(0);
  });
});
