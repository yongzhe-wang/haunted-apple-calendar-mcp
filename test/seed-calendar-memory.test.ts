import { describe, expect, it } from "vitest";
import { defaultSeedWindow, eventToMemoryEvent } from "../src/tools/seed-calendar-memory.js";
import { SeedCalendarMemoryInput } from "../src/types.js";

describe("SeedCalendarMemoryInput", () => {
  it("accepts no params (defaults applied at runtime)", () => {
    expect(() => SeedCalendarMemoryInput.parse({})).not.toThrow();
  });

  it("accepts ISO start_date and end_date", () => {
    expect(() =>
      SeedCalendarMemoryInput.parse({
        start_date: "2021-01-01T00:00:00Z",
        end_date: "2026-01-01T00:00:00Z",
      }),
    ).not.toThrow();
  });

  it("rejects invalid ISO strings", () => {
    expect(() => SeedCalendarMemoryInput.parse({ start_date: "nope" })).toThrow();
  });

  it("rejects more than 64 calendars", () => {
    expect(() =>
      SeedCalendarMemoryInput.parse({
        calendars: Array.from({ length: 65 }, (_, i) => `c-${i}`),
      }),
    ).toThrow();
  });
});

describe("eventToMemoryEvent", () => {
  it("computes duration_hours from start/end", () => {
    const out = eventToMemoryEvent({
      id: "uid-1",
      title: "Lunch",
      start: "2026-04-01T12:00:00Z",
      end: "2026-04-01T13:30:00Z",
      all_day: false,
      calendar_name: "Work",
    });
    expect(out.uid).toBe("uid-1");
    expect(out.duration_hours).toBeCloseTo(1.5, 4);
    expect(out.calendar).toBe("Work");
  });

  it("preserves notes when present", () => {
    const out = eventToMemoryEvent({
      id: "uid-2",
      title: "x",
      start: "2026-04-01T12:00:00Z",
      end: "2026-04-01T13:00:00Z",
      all_day: false,
      calendar_name: "Work",
      notes: "hi",
    });
    expect(out.notes).toBe("hi");
  });

  it("clamps negative duration to 0", () => {
    const out = eventToMemoryEvent({
      id: "uid-3",
      title: "x",
      start: "2026-04-01T13:00:00Z",
      end: "2026-04-01T12:00:00Z",
      all_day: false,
      calendar_name: "Work",
    });
    expect(out.duration_hours).toBe(0);
  });
});

describe("defaultSeedWindow", () => {
  it("returns ~5 years of window", () => {
    const now = new Date("2026-04-01T00:00:00Z");
    const w = defaultSeedWindow(now);
    const startMs = Date.parse(w.start);
    const endMs = Date.parse(w.end);
    const days = (endMs - startMs) / (1000 * 60 * 60 * 24);
    expect(days).toBeGreaterThan(365 * 4.9);
    expect(days).toBeLessThan(365 * 5.1);
    expect(w.end).toBe(now.toISOString());
  });
});
