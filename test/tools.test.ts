import { describe, expect, it } from "vitest";
import { buildCreateEventScript, normalizeCreateEventDuration } from "../src/tools/create-event.js";
import { buildDeleteEventScript } from "../src/tools/delete-event.js";
import { buildListEventsScript, parseEventsOutput } from "../src/tools/list-events.js";
import { matchesQuery } from "../src/tools/search-events.js";
import {
  buildReadEventScript,
  buildUpdateEventCopyScript,
  buildUpdateEventScript,
  buildVerifyEventScript,
  normalizeUpdateEventDuration,
} from "../src/tools/update-event.js";
import {
  CreateEventInput,
  DeleteEventInput,
  ListEventsInput,
  SearchEventsInput,
  UpdateEventInput,
} from "../src/types.js";

describe("input schemas", () => {
  it("list_events requires ISO dates", () => {
    expect(() => ListEventsInput.parse({ start_date: "nope", end_date: "2026-01-01" })).toThrow();
  });

  it("list_events defaults limit to 100", () => {
    const out = ListEventsInput.parse({
      start_date: "2026-01-01",
      end_date: "2026-02-01",
    });
    expect(out.limit).toBe(100);
  });

  it("list_events caps limit at 500", () => {
    expect(() =>
      ListEventsInput.parse({
        start_date: "2026-01-01",
        end_date: "2026-02-01",
        limit: 9999,
      }),
    ).toThrow();
  });

  it("search_events requires non-empty query", () => {
    expect(() => SearchEventsInput.parse({ query: "" })).toThrow();
  });

  it("search_events defaults limit to 50", () => {
    const out = SearchEventsInput.parse({ query: "standup" });
    expect(out.limit).toBe(50);
  });

  it("create_event requires title and dates", () => {
    expect(() => CreateEventInput.parse({ title: "" })).toThrow();
    expect(() =>
      CreateEventInput.parse({
        title: "Meeting",
        start_date: "2026-04-21T10:00:00Z",
        end_date: "2026-04-21T11:00:00Z",
      }),
    ).not.toThrow();
  });

  it("update_event requires event_id", () => {
    expect(() => UpdateEventInput.parse({})).toThrow();
  });

  it("delete_event requires event_id", () => {
    expect(() => DeleteEventInput.parse({})).toThrow();
    expect(() => DeleteEventInput.parse({ event_id: "" })).toThrow();
  });
});

describe("buildListEventsScript", () => {
  it("emits an AppleScript with the expected shape", () => {
    const script = buildListEventsScript({
      start_date: "2026-04-01T00:00:00Z",
      end_date: "2026-04-30T23:59:59Z",
      limit: 50,
    });
    expect(script).toContain('tell application "Calendar"');
    expect(script).toContain("set directEvents to");
    expect(script).toContain("set recurringCandidates to");
    expect(script).toContain("set evRecurrence to");
  });

  it("injects calendar_name safely", () => {
    const script = buildListEventsScript({
      start_date: "2026-04-01T00:00:00Z",
      end_date: "2026-04-30T23:59:59Z",
      limit: 10,
      calendar_name: 'Evil"; do shell script "rm',
    });
    // The malicious quote must be escaped.
    expect(script).toContain('\\"');
    expect(script).not.toMatch(/is not equal to "Evil"; do shell/);
  });
});

describe("buildCreateEventScript", () => {
  it("includes all properties", () => {
    const script = buildCreateEventScript({
      title: "Meeting",
      start_date: "2026-04-21T10:00:00Z",
      end_date: "2026-04-21T11:00:00Z",
      calendar_name: "Work",
      location: "Room 3",
      notes: "Bring laptop",
      url: "https://example.com",
      all_day: false,
    });
    expect(script).toContain('"Meeting"');
    expect(script).toContain('"Work"');
    expect(script).toContain('"Room 3"');
    expect(script).toContain('"Bring laptop"');
    expect(script).toContain('"https://example.com"');
    expect(script).toContain("allday event:false");
  });
});

describe("duration normalization", () => {
  it("extends short create_event requests to one hour", () => {
    const normalized = normalizeCreateEventDuration({
      title: "Short meeting",
      start_date: "2026-04-21T10:00:00Z",
      end_date: "2026-04-21T10:30:00Z",
    });
    expect(normalized.end_date).toBe("2026-04-21T11:00:00.000Z");
  });

  it("extends short update_event requests when both bounds are provided", () => {
    const normalized = normalizeUpdateEventDuration({
      event_id: "abc-123",
      start_date: "2026-04-21T10:00:00Z",
      end_date: "2026-04-21T10:30:00Z",
    });
    expect(normalized.end_date).toBe("2026-04-21T11:00:00.000Z");
  });

  it("does not alter partial update_event requests", () => {
    const normalized = normalizeUpdateEventDuration({
      event_id: "abc-123",
      end_date: "2026-04-21T10:30:00Z",
    });
    expect(normalized.end_date).toBe("2026-04-21T10:30:00Z");
  });
});

describe("buildUpdateEventScript", () => {
  it("only includes setters for provided fields", () => {
    const script = buildUpdateEventScript({
      event_id: "abc-123",
      title: "Renamed",
    });
    expect(script).toContain("set summary of ev to");
    expect(script).not.toContain("set location of ev to");
    expect(script).not.toContain("set description of ev to");
  });

  it("escapes event_id", () => {
    const script = buildUpdateEventScript({
      event_id: 'x"; do shell script "ls',
      title: "ok",
    });
    expect(script).toContain('\\"');
  });

  it("does not emit a move clause — calendar changes go through copy-then-delete", () => {
    const script = buildUpdateEventScript({
      event_id: "abc-123",
      calendar_name: "Appointments",
    });
    // The destructive `move ev to targetCal` path is gone. A same-calendar update
    // may still be called through buildUpdateEventScript, but it must never emit
    // a move even when calendar_name is set.
    expect(script).not.toContain("move ev to targetCal");
    expect(script).not.toContain("set targetCalName to");
  });
});

describe("buildReadEventScript", () => {
  it("looks up the event across all calendars by uid", () => {
    const script = buildReadEventScript("abc-123");
    expect(script).toContain('tell application "Calendar"');
    expect(script).toContain("whose uid is");
    expect(script).toContain('"abc-123"');
    // Must read every property we might need to preserve into the new event.
    expect(script).toContain("summary of ev");
    expect(script).toContain("start date of ev");
    expect(script).toContain("end date of ev");
    expect(script).toContain("allday event of ev");
    expect(script).toContain("location of ev");
    expect(script).toContain("description of ev");
    expect(script).toContain("url of ev");
    expect(script).toContain("name of hostCal");
  });

  it("escapes adversarial event ids", () => {
    const script = buildReadEventScript('id"; do shell script "rm -rf /"; --');
    expect(script).toContain('\\"');
    expect(script).not.toContain('"id"; do shell script "rm');
  });
});

describe("buildUpdateEventCopyScript", () => {
  const merged = {
    title: "Moved meeting",
    start_date: "2026-04-21T10:00:00Z",
    end_date: "2026-04-21T11:00:00Z",
    location: "Room 3",
    notes: "Bring laptop",
    url: "https://example.com",
    all_day: false,
  };

  it("targets the named calendar and sets every merged property", () => {
    const script = buildUpdateEventCopyScript("Appointments", merged);
    expect(script).toContain('"Appointments"');
    expect(script).toContain("make new event with properties");
    expect(script).toContain("summary:");
    expect(script).toContain('"Moved meeting"');
    expect(script).toContain('"Room 3"');
    expect(script).toContain('"Bring laptop"');
    expect(script).toContain('"https://example.com"');
    expect(script).toContain("allday event:false");
    expect(script).toContain("start date:");
    expect(script).toContain("end date:");
  });

  it("escapes adversarial title payloads", () => {
    const script = buildUpdateEventCopyScript("Appointments", {
      ...merged,
      title: '"; do shell script "rm -rf /"; --',
    });
    // The injection attempt must appear only in its escaped form — the raw closing
    // quote after `summary:` would let the payload run as AppleScript.
    expect(script).toContain('\\"; do shell script \\"rm -rf /\\"; --');
    expect(script).not.toContain('summary:""; do shell script "rm');
  });

  it("escapes adversarial target calendar names", () => {
    const script = buildUpdateEventCopyScript('Evil"; do shell script "ls', merged);
    expect(script).toContain('\\"');
    expect(script).not.toMatch(/is "Evil"; do shell/);
  });
});

describe("buildVerifyEventScript", () => {
  it("counts events with the target uid in the target calendar", () => {
    const script = buildVerifyEventScript("new-uid-123", "Appointments");
    expect(script).toContain('tell application "Calendar"');
    expect(script).toContain('"Appointments"');
    expect(script).toContain('"new-uid-123"');
    expect(script).toContain("count of");
  });

  it("escapes both arguments", () => {
    const script = buildVerifyEventScript('"; do shell script "a', '"; do shell script "b');
    expect(script).toContain('\\"');
    expect(script).not.toContain('"""; do shell script "a');
  });
});

describe("updateEvent composition — calendar-change branch", () => {
  // We can't exercise osascript from unit tests, so we compose the builders the
  // way runCopyThenDelete will at runtime and assert that the scripts chain
  // correctly. This guards the ordering: read → create-in-target → verify → delete.
  const args = {
    event_id: "src-uid-1",
    title: "Renamed + moved",
    calendar_name: "Appointments",
  };
  const source = {
    id: "src-uid-1",
    title: "Original",
    start: "2026-04-21T10:00:00Z",
    end: "2026-04-21T11:00:00Z",
    all_day: false,
    calendar_name: "Work",
    location: "",
    notes: "",
    url: "",
  };

  it("generates a read script keyed on the source uid", () => {
    const script = buildReadEventScript(args.event_id);
    expect(script).toContain('"src-uid-1"');
  });

  it("generates a copy script in the target calendar with merged fields", () => {
    const merged = {
      title: args.title ?? source.title,
      start_date: source.start,
      end_date: source.end,
      location: source.location,
      notes: source.notes,
      url: source.url,
      all_day: source.all_day,
    };
    const script = buildUpdateEventCopyScript(args.calendar_name, merged);
    expect(script).toContain('"Appointments"');
    expect(script).toContain('"Renamed + moved"');
    // The original title should not leak through as the new summary.
    expect(script).not.toContain('summary:"Original"');
  });

  it("generates a verify script against the NEW uid, not the source uid", () => {
    const newUid = "dst-uid-999";
    const verify = buildVerifyEventScript(newUid, args.calendar_name);
    expect(verify).toContain('"dst-uid-999"');
    // Verify must NOT use the source uid — the source still exists at this stage.
    expect(verify).not.toContain('"src-uid-1"');
  });

  it("delete-source step keys on the original source uid", async () => {
    const { buildDeleteEventScript } = await import("../src/tools/delete-event.js");
    const del = buildDeleteEventScript({ event_id: source.id });
    expect(del).toContain('"src-uid-1"');
  });
});

describe("updateEvent — no calendar change means in-place path", () => {
  it("buildUpdateEventScript handles same-calendar rename without a move or copy", () => {
    // When calendar_name is omitted, updateEvent skips the source lookup and the
    // copy/verify/delete sequence entirely. Verify the in-place script is usable
    // on its own: it must update summary and NOT attempt any move.
    const script = buildUpdateEventScript({
      event_id: "abc-123",
      title: "Renamed",
    });
    expect(script).toContain("set summary of ev to");
    expect(script).not.toContain("move ev to targetCal");
    expect(script).not.toContain("make new event");
  });
});

describe("buildDeleteEventScript", () => {
  it("escapes event_id", () => {
    const script = buildDeleteEventScript({ event_id: 'a"b' });
    expect(script).toContain('\\"');
  });
});

describe("parseEventsOutput", () => {
  it("returns [] for empty input", () => {
    expect(parseEventsOutput("")).toEqual([]);
  });

  it("parses a single event with all fields", () => {
    const RS = "\x1e";
    const US = "\x1f";
    const start = "2026-04-21T10:00:00";
    const end = "2026-04-21T11:00:00";
    const raw =
      [
        "uid-1",
        "Meeting",
        start,
        end,
        "false",
        "Room 3",
        "Bring laptop",
        "Work",
        "https://example.com",
      ].join(US) + RS;

    const events = parseEventsOutput(raw);
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e).toBeDefined();
    if (!e) {
      return;
    }
    expect(e.id).toBe("uid-1");
    expect(e.title).toBe("Meeting");
    expect(e.all_day).toBe(false);
    expect(e.location).toBe("Room 3");
    expect(e.url).toBe("https://example.com");
    expect(e.calendar_name).toBe("Work");
    expect(e.start).toBe(new Date(start).toISOString());
  });

  it("expands weekly recurring events into the requested Apple Calendar day", () => {
    const RS = "\x1e";
    const US = "\x1f";
    const record = [
      "course-1",
      "math2410 class",
      "2026-01-15T10:15:00",
      "2026-01-15T11:45:00",
      "false",
      "missing value",
      "",
      "Courses",
      "",
      "FREQ=WEEKLY;INTERVAL=1;BYDAY=TU,TH",
    ].join(US);
    const raw = record + RS + record + RS;

    const events = parseEventsOutput(raw, {
      start_date: "2026-04-21T00:00:00-04:00",
      end_date: "2026-04-21T23:59:59-04:00",
      limit: 100,
    });

    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e).toBeDefined();
    if (!e) {
      return;
    }
    expect(e.title).toBe("math2410 class");
    expect(e.calendar_name).toBe("Courses");
    expect(e.location).toBeUndefined();
    expect(e.start).toBe(new Date(2026, 3, 21, 10, 15).toISOString());
    expect(e.end).toBe(new Date(2026, 3, 21, 11, 45).toISOString());
  });
});

describe("matchesQuery", () => {
  const base = {
    id: "1",
    title: "Team Standup",
    start: "",
    end: "",
    all_day: false,
    calendar_name: "Work",
  };

  it("matches case-insensitively on title", () => {
    expect(matchesQuery(base, "standup")).toBe(true);
    expect(matchesQuery(base, "STANDUP")).toBe(true);
  });

  it("matches on location", () => {
    expect(matchesQuery({ ...base, location: "Zoom Room A" }, "zoom")).toBe(true);
  });

  it("matches on notes", () => {
    expect(matchesQuery({ ...base, notes: "Discuss roadmap" }, "roadmap")).toBe(true);
  });

  it("returns false when no field matches", () => {
    expect(matchesQuery(base, "missing")).toBe(false);
  });
});
