import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  emptyMemory,
  loadMemory,
  mergeEvents,
  queryByCalendar,
  queryByDateRange,
  queryByPerson,
  queryByTopic,
  recentSimilarEvents,
  saveMemory,
  tokenize,
  type MemoryEvent,
  type MemoryFile,
} from "../src/memory.js";

let workdir = "";

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "yu-memory-"));
});

afterEach(() => {
  if (workdir) {
    rmSync(workdir, { recursive: true, force: true });
  }
});

function mkEvent(overrides: Partial<MemoryEvent> = {}): MemoryEvent {
  return {
    uid: overrides.uid ?? `uid-${Math.random()}`,
    title: overrides.title ?? "lunch with leo",
    start: overrides.start ?? "2026-04-01T12:00:00Z",
    end: overrides.end ?? "2026-04-01T13:00:00Z",
    duration_hours: overrides.duration_hours ?? 1,
    calendar: overrides.calendar ?? "Work",
    ...(overrides.notes !== undefined ? { notes: overrides.notes } : {}),
    ...(overrides.attended !== undefined ? { attended: overrides.attended } : {}),
    ...(overrides.observations !== undefined ? { observations: overrides.observations } : {}),
  };
}

describe("loadMemory", () => {
  it("returns an empty file when path does not exist", () => {
    const out = loadMemory(join(workdir, "no-such-file.json"));
    expect(out.version).toBe(1);
    expect(out.events).toEqual([]);
  });

  it("returns empty when file exists but is empty", () => {
    const path = join(workdir, "memory.json");
    writeFileSync(path, "");
    const out = loadMemory(path);
    expect(out.events).toEqual([]);
  });

  it("returns empty when file is corrupt", () => {
    const path = join(workdir, "memory.json");
    writeFileSync(path, "{not json");
    const out = loadMemory(path);
    expect(out.events).toEqual([]);
  });
});

describe("saveMemory + loadMemory roundtrip", () => {
  it("writes via .tmp and renames", () => {
    const path = join(workdir, "memory.json");
    const memory: MemoryFile = {
      version: 1,
      last_updated: "2026-04-01T00:00:00Z",
      events: [mkEvent({ uid: "a", title: "x" })],
    };
    saveMemory(memory, path);
    expect(existsSync(path)).toBe(true);
    expect(existsSync(`${path}.tmp`)).toBe(false);
    // sanity: file is non-empty
    expect(statSync(path).size).toBeGreaterThan(0);
    // no leftover .tmp files in dir
    const leftovers = readdirSync(workdir).filter((f) => f.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
    // roundtrip
    const back = loadMemory(path);
    expect(back.events.length).toBe(1);
    expect(back.events[0]?.uid).toBe("a");
  });
});

describe("mergeEvents", () => {
  it("dedupes by UID with later writes overwriting earlier", () => {
    const m = emptyMemory();
    const merged1 = mergeEvents(m, [mkEvent({ uid: "a", title: "old" })]);
    const merged2 = mergeEvents(merged1, [mkEvent({ uid: "a", title: "new" })]);
    expect(merged2.events.length).toBe(1);
    expect(merged2.events[0]?.title).toBe("new");
  });

  it("keeps disjoint UIDs", () => {
    const m = emptyMemory();
    const merged = mergeEvents(m, [mkEvent({ uid: "a" }), mkEvent({ uid: "b" })]);
    expect(merged.events.length).toBe(2);
  });

  it("unions observations across writes", () => {
    const m = emptyMemory();
    const m1 = mergeEvents(m, [mkEvent({ uid: "a", observations: ["was tired"] })]);
    const m2 = mergeEvents(m1, [mkEvent({ uid: "a", observations: ["got coffee"] })]);
    expect(m2.events[0]?.observations?.toSorted()).toEqual(["got coffee", "was tired"]);
  });
});

describe("queryByPerson", () => {
  const memory: MemoryFile = {
    version: 1,
    last_updated: "2026-04-01T00:00:00Z",
    events: [
      mkEvent({ uid: "1", title: "Lunch with Leo" }),
      mkEvent({ uid: "2", title: "Dinner with Eleanor", notes: "leo joined" }),
      mkEvent({ uid: "3", title: "Standup" }),
    ],
  };

  it("matches case-insensitively in title", () => {
    expect(queryByPerson(memory, "leo").length).toBe(2);
    expect(queryByPerson(memory, "LEO").length).toBe(2);
  });

  it("matches in notes", () => {
    expect(queryByPerson(memory, "eleanor").length).toBe(1);
  });

  it("returns nothing for empty needle", () => {
    expect(queryByPerson(memory, "")).toEqual([]);
  });
});

describe("queryByTopic / queryByCalendar / queryByDateRange", () => {
  const memory: MemoryFile = {
    version: 1,
    last_updated: "2026-04-01T00:00:00Z",
    events: [
      mkEvent({
        uid: "1",
        title: "Calc final exam",
        calendar: "School",
        start: "2026-01-15T09:00:00Z",
      }),
      mkEvent({ uid: "2", title: "team standup", calendar: "Work", start: "2026-04-15T09:00:00Z" }),
    ],
  };

  it("queryByTopic matches keyword in title", () => {
    expect(queryByTopic(memory, "exam").length).toBe(1);
  });

  it("queryByCalendar matches by calendar name", () => {
    expect(queryByCalendar(memory, "Work").length).toBe(1);
    expect(queryByCalendar(memory, "school").length).toBe(1);
  });

  it("queryByDateRange filters by start ts", () => {
    expect(queryByDateRange(memory, "2026-04-01T00:00:00Z", "2026-04-30T23:59:59Z").length).toBe(1);
  });
});

describe("recentSimilarEvents", () => {
  const memory: MemoryFile = {
    version: 1,
    last_updated: "2026-04-01T00:00:00Z",
    events: [
      mkEvent({ uid: "1", title: "lunch with leo", start: "2025-04-01T12:00:00Z" }),
      mkEvent({ uid: "2", title: "lunch with leo", start: "2026-03-15T12:00:00Z" }),
      mkEvent({ uid: "3", title: "team standup", start: "2026-04-01T09:00:00Z" }),
      mkEvent({ uid: "4", title: "dinner with eleanor", start: "2026-04-10T18:00:00Z" }),
    ],
  };

  it("returns most-similar events newest-first", () => {
    const out = recentSimilarEvents(memory, { title: "lunch with leo and eleanor" }, 3);
    expect(out.length).toBeGreaterThan(0);
    // Two events directly share "lunch","leo"; newest one first.
    const ids = out.map((e) => e.uid);
    expect(ids[0]).toBe("2");
  });

  it("returns nothing when no token overlap", () => {
    const out = recentSimilarEvents(memory, { title: "qwertyuiop" }, 5);
    expect(out).toEqual([]);
  });

  it("limit caps result size", () => {
    const out = recentSimilarEvents(memory, { title: "lunch" }, 1);
    expect(out.length).toBe(1);
  });
});

describe("tokenize", () => {
  it("drops stopwords and short tokens", () => {
    expect(tokenize("the lunch with leo")).toEqual(["lunch", "leo"]);
  });
});
