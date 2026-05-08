import { describe, expect, it } from "vitest";
import {
  buildListEventsScript,
  eventOccursInWindow,
  parseEventsOutput,
  type ParsedEventRecord,
} from "../src/tools/list-events.js";

const RS = "\x1e";
const US = "\x1f";

function makeRaw(records: string[][]): string {
  return records.map((r) => r.join(US)).join(RS) + (records.length ? RS : "");
}

function makeEvent(overrides: Partial<ParsedEventRecord>): ParsedEventRecord {
  return {
    id: "uid",
    title: "ev",
    start: new Date(2026, 4, 5, 10, 0).toISOString(),
    end: new Date(2026, 4, 5, 11, 0).toISOString(),
    all_day: false,
    calendar_name: "Work",
    ...overrides,
  };
}

describe("buildListEventsScript widened recurrence lookback", () => {
  it("uses a 730-day lookback for recurring candidates", () => {
    const script = buildListEventsScript({
      start_date: "2026-05-04T00:00:00-04:00",
      end_date: "2026-05-09T23:59:59-04:00",
      limit: 100,
    });
    expect(script).toContain("(730 * days)");
    // The previous 180-day window is the bug we're closing — make sure we
    // never silently regress to it.
    expect(script).not.toContain("(180 * days)");
  });
});

describe("parseEventsOutput recurrence-aware filter (0.6.2)", () => {
  // Window: May 4 -> May 9 2026 local time. Recreates the production query
  // that silently dropped the three weekly events flagged in 0.6.2.
  const args = {
    start_date: new Date(2026, 4, 4, 0, 0).toISOString(),
    end_date: new Date(2026, 4, 9, 23, 59, 59).toISOString(),
    limit: 100,
  };

  it("returns a single event whose start lies inside the window", () => {
    const raw = makeRaw([
      [
        "uid-in",
        "Inside meeting",
        "2026-05-05T10:00:00",
        "2026-05-05T11:00:00",
        "false",
        "",
        "",
        "Work",
        "",
      ],
    ]);
    const events = parseEventsOutput(raw, args);
    expect(events.map((e) => e.id)).toEqual(["uid-in"]);
  });

  it("drops a non-recurring event whose start is before the window", () => {
    const raw = makeRaw([
      [
        "uid-before",
        "Before window",
        "2025-12-01T10:00:00",
        "2025-12-01T11:00:00",
        "false",
        "",
        "",
        "Work",
        "",
      ],
    ]);
    expect(parseEventsOutput(raw, args)).toEqual([]);
  });

  it("includes a weekly recurring event whose master is 90 days before the window", () => {
    // Master: Feb 6 2026 (Friday). RRULE WEEKLY → occurs every Friday.
    // Friday inside the window is May 8 2026.
    const raw = makeRaw([
      [
        "uid-cis5800",
        "andrew wang oh cis5800",
        "2026-02-06T15:00:00",
        "2026-02-06T16:00:00",
        "false",
        "",
        "",
        "Work",
        "",
        "FREQ=WEEKLY;INTERVAL=1;BYDAY=FR",
      ],
    ]);
    const events = parseEventsOutput(raw, args);
    expect(events).toHaveLength(1);
    const ev = events[0];
    expect(ev).toBeDefined();
    if (!ev) {
      return;
    }
    expect(ev.title).toBe("andrew wang oh cis5800");
    // Surfaces the new recurrence_rule field on every emitted occurrence.
    expect(ev.recurrence_rule).toBe("FREQ=WEEKLY;INTERVAL=1;BYDAY=FR");
    expect(ev.start).toBe(new Date(2026, 4, 8, 15, 0).toISOString());
  });

  it("drops a weekly recurring event whose UNTIL falls before the window", () => {
    const raw = makeRaw([
      [
        "uid-stopped",
        "Stopped weekly",
        "2026-02-06T15:00:00",
        "2026-02-06T16:00:00",
        "false",
        "",
        "",
        "Work",
        "",
        "FREQ=WEEKLY;INTERVAL=1;BYDAY=FR;UNTIL=20260301T000000Z",
      ],
    ]);
    expect(parseEventsOutput(raw, args)).toEqual([]);
  });

  it("drops a weekly recurring event whose master starts after the window", () => {
    const raw = makeRaw([
      [
        "uid-future",
        "Future weekly",
        "2026-09-01T15:00:00",
        "2026-09-01T16:00:00",
        "false",
        "",
        "",
        "Work",
        "",
        "FREQ=WEEKLY;INTERVAL=1;BYDAY=TU",
      ],
    ]);
    expect(parseEventsOutput(raw, args)).toEqual([]);
  });

  it("drops a weekly recurring event whose COUNT cap is exhausted before the window", () => {
    // 3 occurrences starting Feb 6 → Feb 6, Feb 13, Feb 20. None in May.
    const raw = makeRaw([
      [
        "uid-count",
        "Limited weekly",
        "2026-02-06T15:00:00",
        "2026-02-06T16:00:00",
        "false",
        "",
        "",
        "Work",
        "",
        "FREQ=WEEKLY;INTERVAL=1;BYDAY=FR;COUNT=3",
      ],
    ]);
    expect(parseEventsOutput(raw, args)).toEqual([]);
  });

  it("expands DAILY recurrences into the window", () => {
    // Master: April 1 2026, DAILY interval=1. Should emit one occurrence per
    // day in the May 4-9 window.
    const raw = makeRaw([
      [
        "uid-daily",
        "Standup",
        "2026-04-01T09:00:00",
        "2026-04-01T09:15:00",
        "false",
        "",
        "",
        "Work",
        "",
        "FREQ=DAILY;INTERVAL=1",
      ],
    ]);
    const events = parseEventsOutput(raw, args);
    // 6 days inclusive → 6 occurrences.
    expect(events).toHaveLength(6);
    expect(events.every((e) => e.title === "Standup")).toBe(true);
  });

  it("expands MONTHLY recurrences with master before the window", () => {
    // Master: Jan 7 2026 → next on May 7 falls inside window.
    const raw = makeRaw([
      [
        "uid-monthly",
        "Pay rent",
        "2026-01-07T09:00:00",
        "2026-01-07T09:30:00",
        "false",
        "",
        "",
        "Personal",
        "",
        "FREQ=MONTHLY;INTERVAL=1",
      ],
    ]);
    const events = parseEventsOutput(raw, args);
    expect(events).toHaveLength(1);
    const ev = events[0];
    expect(ev).toBeDefined();
    if (!ev) {
      return;
    }
    expect(ev.start).toBe(new Date(2026, 4, 7, 9, 0).toISOString());
  });
});

describe("eventOccursInWindow helper", () => {
  const rangeStart = new Date(2026, 4, 4, 0, 0);
  const rangeEnd = new Date(2026, 4, 9, 23, 59, 59);

  it("returns true for a non-recurring event inside the window", () => {
    const event = makeEvent({
      start: new Date(2026, 4, 5, 10, 0).toISOString(),
      end: new Date(2026, 4, 5, 11, 0).toISOString(),
    });
    expect(eventOccursInWindow(event, rangeStart, rangeEnd)).toBe(true);
  });

  it("returns false for a non-recurring event before the window", () => {
    const event = makeEvent({
      start: new Date(2026, 0, 1, 10, 0).toISOString(),
      end: new Date(2026, 0, 1, 11, 0).toISOString(),
    });
    expect(eventOccursInWindow(event, rangeStart, rangeEnd)).toBe(false);
  });

  it("returns true for a weekly recurring event whose master is before the window", () => {
    const event = makeEvent({
      start: new Date(2026, 1, 6, 15, 0).toISOString(),
      end: new Date(2026, 1, 6, 16, 0).toISOString(),
      recurrence: "FREQ=WEEKLY;INTERVAL=1;BYDAY=FR",
    });
    expect(eventOccursInWindow(event, rangeStart, rangeEnd)).toBe(true);
  });

  it("returns false for an unknown FREQ when the master is outside the window", () => {
    // Conservative fallback: include only when master start overlaps the
    // window. Master here is in January, well before May.
    const event = makeEvent({
      start: new Date(2026, 0, 1, 10, 0).toISOString(),
      end: new Date(2026, 0, 1, 11, 0).toISOString(),
      recurrence: "FREQ=HOURLY;INTERVAL=1",
    });
    expect(eventOccursInWindow(event, rangeStart, rangeEnd)).toBe(false);
  });
});
