import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock applescript.js BEFORE importing anything that depends on it. The rest of
// the module's exports must pass through untouched so the script builders that
// call `escapeAppleScriptString` / `isoToAppleScriptDate` keep working.
vi.mock("../src/applescript.js", async () => {
  const actual =
    await vi.importActual<typeof import("../src/applescript.js")>("../src/applescript.js");
  return {
    ...actual,
    runAppleScript: vi.fn(),
  };
});

// Imports must come after vi.mock so the mocked module is the one the source
// resolves. Dynamic imports inside each test would also work but this matches
// the existing tools.test.ts style.
import { runAppleScript, UNIT_SEPARATOR } from "../src/applescript.js";
import { AppleCalendarError } from "../src/errors.js";
import { readSourceEvent, updateEvent } from "../src/tools/update-event.js";

const US = UNIT_SEPARATOR;
const RS = "\x1e";

// Source read output builder — must match buildReadEventScript's emission contract:
// uid | summary | start | end | all_day | location | notes | calendar_name | url | recurrence
function readFixture(opts: {
  id?: string;
  title?: string;
  start?: string;
  end?: string;
  all_day?: boolean;
  location?: string;
  notes?: string;
  calendar_name?: string;
  url?: string;
  recurrence?: string;
}): string {
  const fields = [
    opts.id ?? "src-uid-1",
    opts.title ?? "Original",
    opts.start ?? "2026-04-21T10:00:00",
    opts.end ?? "2026-04-21T11:00:00",
    opts.all_day === true ? "true" : "false",
    opts.location ?? "",
    opts.notes ?? "",
    opts.calendar_name ?? "Work",
    opts.url ?? "",
    opts.recurrence ?? "",
  ];
  return fields.join(US);
}

// Copy script output builder — matches buildUpdateEventCopyScript's return shape:
// uid | summary | start | end | all_day | location | notes | calendar_name | url
function copyFixture(opts: {
  id?: string;
  title?: string;
  start?: string;
  end?: string;
  all_day?: boolean;
  location?: string;
  notes?: string;
  calendar_name?: string;
  url?: string;
}): string {
  const fields = [
    opts.id ?? "dst-uid-999",
    opts.title ?? "Moved",
    opts.start ?? "2026-04-21T10:00:00",
    opts.end ?? "2026-04-21T11:00:00",
    opts.all_day === true ? "true" : "false",
    opts.location ?? "",
    opts.notes ?? "",
    opts.calendar_name ?? "Appointments",
    opts.url ?? "",
  ];
  return fields.join(US);
}

// listCalendars parseRecords input: name US writable RS, concatenated per cal.
function calendarsFixture(cals: Array<{ name: string; writable: boolean }>): string {
  return cals.map((c) => `${c.name}${US}${c.writable ? "true" : "false"}`).join(RS) + RS;
}

const runAppleScriptMock = vi.mocked(runAppleScript);

beforeEach(() => {
  runAppleScriptMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("updateEvent — orchestrator paths (mocked runAppleScript)", () => {
  it("skips source lookup when calendar_name is undefined", async () => {
    // Only the in-place script should run. No listCalendars, no read.
    runAppleScriptMock.mockResolvedValueOnce(
      copyFixture({
        id: "src-uid-1",
        title: "Renamed",
        calendar_name: "Work",
      }),
    );

    const result = await updateEvent({
      event_id: "src-uid-1",
      title: "Renamed",
    });

    expect(runAppleScriptMock).toHaveBeenCalledTimes(1);
    const script = runAppleScriptMock.mock.calls[0]?.[0] ?? "";
    // Neither the listCalendars preface nor the read script's "repeat with cal in calendars"
    // id-lookup should appear; the in-place script has setters.
    expect(script).toContain("set summary of ev to");
    expect(script).not.toContain("make new event");
    expect(result.id).toBe("src-uid-1");
  });

  it("takes in-place path when canonical calendar name matches source (trimmed, case-insensitive)", async () => {
    // Call 1: listCalendars.
    runAppleScriptMock.mockResolvedValueOnce(calendarsFixture([{ name: "Work", writable: true }]));
    // Call 2: readSourceEvent — source is on "Work".
    runAppleScriptMock.mockResolvedValueOnce(readFixture({ calendar_name: "Work" }));
    // Call 3: in-place update (because target resolves to same canonical "Work").
    runAppleScriptMock.mockResolvedValueOnce(
      copyFixture({ id: "src-uid-1", calendar_name: "Work" }),
    );

    const result = await updateEvent({
      event_id: "src-uid-1",
      calendar_name: "work ",
      title: "Renamed",
    });

    expect(runAppleScriptMock).toHaveBeenCalledTimes(3);
    // Third call must be the in-place update script — NOT the copy script.
    const script = runAppleScriptMock.mock.calls[2]?.[0] ?? "";
    expect(script).toContain("set summary of ev to");
    expect(script).not.toContain("make new event with properties");
    expect(result.id).toBe("src-uid-1");
  });

  it("aborts when verify returns 0 (copy didn't land)", async () => {
    runAppleScriptMock.mockResolvedValueOnce(
      calendarsFixture([
        { name: "Work", writable: true },
        { name: "Appointments", writable: true },
      ]),
    );
    runAppleScriptMock.mockResolvedValueOnce(readFixture({ calendar_name: "Work" }));
    runAppleScriptMock.mockResolvedValueOnce(
      copyFixture({ id: "dst-uid-999", calendar_name: "Appointments" }),
    );
    runAppleScriptMock.mockResolvedValueOnce("0");

    await expect(
      updateEvent({ event_id: "src-uid-1", calendar_name: "Appointments" }),
    ).rejects.toThrow(/preserved/i);

    // 4 calls: listCalendars, read, copy, verify. Delete should NOT be invoked.
    expect(runAppleScriptMock).toHaveBeenCalledTimes(4);
  });

  it("aborts when verify returns > 1 (duplicate copies)", async () => {
    runAppleScriptMock.mockResolvedValueOnce(
      calendarsFixture([
        { name: "Work", writable: true },
        { name: "Appointments", writable: true },
      ]),
    );
    runAppleScriptMock.mockResolvedValueOnce(readFixture({ calendar_name: "Work" }));
    runAppleScriptMock.mockResolvedValueOnce(
      copyFixture({ id: "dst-uid-999", calendar_name: "Appointments" }),
    );
    runAppleScriptMock.mockResolvedValueOnce("2");

    await expect(
      updateEvent({ event_id: "src-uid-1", calendar_name: "Appointments" }),
    ).rejects.toThrow(/preserved/i);

    expect(runAppleScriptMock).toHaveBeenCalledTimes(4);
  });

  it("aborts when created.id === source.id (same-uid delete race)", async () => {
    runAppleScriptMock.mockResolvedValueOnce(
      calendarsFixture([
        { name: "Work", writable: true },
        { name: "Appointments", writable: true },
      ]),
    );
    runAppleScriptMock.mockResolvedValueOnce(
      readFixture({ id: "src-uid-1", calendar_name: "Work" }),
    );
    // Copy returns the SAME uid as the source — the data-loss mechanism.
    runAppleScriptMock.mockResolvedValueOnce(
      copyFixture({ id: "src-uid-1", calendar_name: "Appointments" }),
    );

    await expect(
      updateEvent({ event_id: "src-uid-1", calendar_name: "Appointments" }),
    ).rejects.toThrow(/overwrite|same uid/i);

    // 3 calls total: listCalendars, read, copy. No verify, no delete.
    expect(runAppleScriptMock).toHaveBeenCalledTimes(3);
  });

  it("refuses to copy a recurring event across calendars", async () => {
    runAppleScriptMock.mockResolvedValueOnce(
      calendarsFixture([
        { name: "Work", writable: true },
        { name: "Appointments", writable: true },
      ]),
    );
    runAppleScriptMock.mockResolvedValueOnce(
      readFixture({
        calendar_name: "Work",
        recurrence: "FREQ=WEEKLY;BYDAY=TU,TH",
      }),
    );

    await expect(
      updateEvent({ event_id: "src-uid-1", calendar_name: "Appointments" }),
    ).rejects.toThrow(/recurring|recurrence rule/i);

    // 2 calls: listCalendars, read. Copy/verify/delete must all be skipped.
    expect(runAppleScriptMock).toHaveBeenCalledTimes(2);
  });

  it("rejects read-only target calendars before touching the source event", async () => {
    runAppleScriptMock.mockResolvedValueOnce(
      calendarsFixture([
        { name: "Work", writable: true },
        { name: "Holidays", writable: false },
      ]),
    );

    await expect(updateEvent({ event_id: "src-uid-1", calendar_name: "Holidays" })).rejects.toThrow(
      /read-only/i,
    );

    // Only listCalendars should have run — no source read.
    expect(runAppleScriptMock).toHaveBeenCalledTimes(1);
  });

  it("rejects nonexistent target calendars", async () => {
    runAppleScriptMock.mockResolvedValueOnce(calendarsFixture([{ name: "Work", writable: true }]));

    await expect(updateEvent({ event_id: "src-uid-1", calendar_name: "Gone" })).rejects.toThrow(
      /not found/i,
    );

    expect(runAppleScriptMock).toHaveBeenCalledTimes(1);
  });

  it("returns new event and logs stderr warning when delete fails", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    runAppleScriptMock.mockResolvedValueOnce(
      calendarsFixture([
        { name: "Work", writable: true },
        { name: "Appointments", writable: true },
      ]),
    );
    runAppleScriptMock.mockResolvedValueOnce(readFixture({ calendar_name: "Work" }));
    runAppleScriptMock.mockResolvedValueOnce(
      copyFixture({ id: "dst-uid-999", calendar_name: "Appointments" }),
    );
    runAppleScriptMock.mockResolvedValueOnce("1");
    runAppleScriptMock.mockRejectedValueOnce(new Error("delete blew up"));

    const result = await updateEvent({
      event_id: "src-uid-1",
      calendar_name: "Appointments",
    });

    expect(result.id).toBe("dst-uid-999");
    const writes = stderrSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(writes).toMatch(/WARNING/);
    expect(writes).toMatch(/manual cleanup/);
    stderrSpy.mockRestore();
  });

  it("wraps create failure with source-preserved message and skips verify/delete", async () => {
    runAppleScriptMock.mockResolvedValueOnce(
      calendarsFixture([
        { name: "Work", writable: true },
        { name: "Appointments", writable: true },
      ]),
    );
    runAppleScriptMock.mockResolvedValueOnce(readFixture({ calendar_name: "Work" }));
    runAppleScriptMock.mockRejectedValueOnce(new Error("make new event failed"));

    // The user-facing message carries the "preserved" guarantee; the internal
    // message carries the underlying osascript detail.
    let caught: unknown = null;
    try {
      await updateEvent({ event_id: "src-uid-1", calendar_name: "Appointments" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AppleCalendarError);
    expect((caught as AppleCalendarError).userFacing).toMatch(/preserved/i);
    expect((caught as AppleCalendarError).message).toMatch(/failed to create copy/i);

    // Only 3 calls: listCalendars, read, copy (which threw). No verify, no delete.
    expect(runAppleScriptMock).toHaveBeenCalledTimes(3);
  });

  it("wraps create failure details in an AppleCalendarError", async () => {
    runAppleScriptMock.mockResolvedValueOnce(
      calendarsFixture([
        { name: "Work", writable: true },
        { name: "Appointments", writable: true },
      ]),
    );
    runAppleScriptMock.mockResolvedValueOnce(readFixture({ calendar_name: "Work" }));
    runAppleScriptMock.mockRejectedValueOnce(new Error("boom"));

    await expect(
      updateEvent({ event_id: "src-uid-1", calendar_name: "Appointments" }),
    ).rejects.toBeInstanceOf(AppleCalendarError);
  });
});

describe("readSourceEvent — UNSET sentinel + recurrence parsing", () => {
  // Must match the sentinel in update-event.ts. The contract is a stable string,
  // so duplicating it in the test is intentional: if either side drifts, the test fails.
  const UNSET = "\x03UNSET\x03";

  it("parses UNSET sentinel to undefined for optional fields", async () => {
    // Build a raw read output where location + notes carry the sentinel, but url is "".
    // Expectation: location/notes -> undefined, url -> "" (not sentinel = empty string).
    const raw = [
      "src-uid-1",
      "Original",
      "2026-04-21T10:00:00",
      "2026-04-21T11:00:00",
      "false",
      UNSET,
      UNSET,
      "Work",
      "",
      "",
    ].join(US);
    runAppleScriptMock.mockResolvedValueOnce(raw);

    const source = await readSourceEvent("src-uid-1");

    expect(source.location).toBeUndefined();
    expect(source.notes).toBeUndefined();
    expect(source.url).toBe("");
    expect(source.recurrence).toBeNull();
  });

  it("parses RRULE recurrence string into source.recurrence", async () => {
    const raw = [
      "src-uid-1",
      "Weekly class",
      "2026-04-21T10:00:00",
      "2026-04-21T11:00:00",
      "false",
      "",
      "",
      "Courses",
      "",
      "FREQ=WEEKLY;BYDAY=TU,TH",
    ].join(US);
    runAppleScriptMock.mockResolvedValueOnce(raw);

    const source = await readSourceEvent("src-uid-1");

    expect(source.recurrence).toBe("FREQ=WEEKLY;BYDAY=TU,TH");
  });

  it("preserves local-stamp VERBATIM for all-day events (no UTC shift)", async () => {
    // all_day=true: the start/end are raw AppleScript local stamps, not ISO. The
    // read path must NOT round-trip them through toISOString() — that's the exact
    // bug that shifted all-day events by local UTC offset.
    const raw = [
      "src-uid-1",
      "Birthday",
      "2026-04-21T00:00:00",
      "2026-04-22T00:00:00",
      "true",
      "",
      "",
      "Personal",
      "",
      "",
    ].join(US);
    runAppleScriptMock.mockResolvedValueOnce(raw);

    const source = await readSourceEvent("src-uid-1");

    expect(source.all_day).toBe(true);
    expect(source.start).toBe("2026-04-21T00:00:00");
    expect(source.end).toBe("2026-04-22T00:00:00");
  });
});
