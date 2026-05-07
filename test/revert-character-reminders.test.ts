import { describe, expect, it } from "vitest";
import { BACKUP_BLOCK_CLOSE, BACKUP_BLOCK_OPEN } from "../src/tools/apply-character-reminders.js";
import { filterEventsWithBackup } from "../src/tools/revert-character-reminders.js";
import type { CalendarEvent } from "../src/types.js";
import { RevertCharacterRemindersInput } from "../src/types.js";

describe("RevertCharacterRemindersInput", () => {
  it("accepts no args (full sweep)", () => {
    expect(() => RevertCharacterRemindersInput.parse({})).not.toThrow();
  });

  it("accepts ISO start_date / end_date", () => {
    expect(() =>
      RevertCharacterRemindersInput.parse({
        start_date: "2026-04-01T00:00:00Z",
        end_date: "2026-05-01T00:00:00Z",
      }),
    ).not.toThrow();
  });

  it("rejects non-ISO start_date", () => {
    expect(() => RevertCharacterRemindersInput.parse({ start_date: "yesterday" })).toThrow();
  });

  it("rejects more than 20 calendars", () => {
    expect(() =>
      RevertCharacterRemindersInput.parse({
        calendars: Array.from({ length: 21 }, (_, i) => `c-${i}`),
      }),
    ).toThrow();
  });
});

describe("filterEventsWithBackup", () => {
  function mk(id: string, notes?: string): CalendarEvent {
    const base: CalendarEvent = {
      id,
      title: id,
      start: "2026-04-01T09:00:00Z",
      end: "2026-04-01T10:00:00Z",
      all_day: false,
      calendar_name: "Work",
    };
    if (notes !== undefined) {
      base.notes = notes;
    }
    return base;
  }

  it("only keeps events whose notes carry the backup sentinel", () => {
    const events = [
      mk("a", `pre\n${BACKUP_BLOCK_OPEN}\n{}\n${BACKUP_BLOCK_CLOSE}`),
      mk("b", "no backup here"),
      mk("c"),
    ];
    const out = filterEventsWithBackup(events);
    expect(out.map((e) => e.uid)).toEqual(["a"]);
    expect(out[0]?.calendar).toBe("Work");
  });

  it("preserves order", () => {
    const events = [
      mk("a", `${BACKUP_BLOCK_OPEN}{}${BACKUP_BLOCK_CLOSE}`),
      mk("b", "x"),
      mk("c", `${BACKUP_BLOCK_OPEN}{}${BACKUP_BLOCK_CLOSE}`),
    ];
    const out = filterEventsWithBackup(events);
    expect(out.map((e) => e.uid)).toEqual(["a", "c"]);
  });
});
