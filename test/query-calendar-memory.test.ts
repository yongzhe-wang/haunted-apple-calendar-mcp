import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveMemory, type MemoryFile } from "../src/memory.js";
import { runMemoryQuery } from "../src/tools/query-calendar-memory.js";
import { QueryCalendarMemoryInput } from "../src/types.js";

let workdir = "";
let memoryPath = "";

const FIXTURE: MemoryFile = {
  version: 1,
  last_updated: "2026-04-01T00:00:00Z",
  events: [
    {
      uid: "1",
      title: "Lunch with Leo",
      start: "2025-12-01T12:00:00Z",
      end: "2025-12-01T13:00:00Z",
      duration_hours: 1,
      calendar: "Work",
    },
    {
      uid: "2",
      title: "Calc final exam",
      start: "2026-01-10T09:00:00Z",
      end: "2026-01-10T11:00:00Z",
      duration_hours: 2,
      calendar: "School",
    },
    {
      uid: "3",
      title: "DMV license renewal",
      start: "2026-03-20T10:00:00Z",
      end: "2026-03-20T11:00:00Z",
      duration_hours: 1,
      calendar: "Personal",
    },
  ],
};

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "yu-qmemory-"));
  memoryPath = join(workdir, "memory.json");
  saveMemory(FIXTURE, memoryPath);
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe("QueryCalendarMemoryInput schema", () => {
  it("requires query_string for by_person", () => {
    expect(() => QueryCalendarMemoryInput.parse({ query_type: "by_person" })).toThrow();
  });
  it("requires start_date+end_date for by_date_range", () => {
    expect(() =>
      QueryCalendarMemoryInput.parse({
        query_type: "by_date_range",
        start_date: "2026-01-01T00:00:00Z",
      }),
    ).toThrow();
  });
  it("requires event for similar_to", () => {
    expect(() => QueryCalendarMemoryInput.parse({ query_type: "similar_to" })).toThrow();
  });
  it("accepts all without params", () => {
    expect(() => QueryCalendarMemoryInput.parse({ query_type: "all" })).not.toThrow();
  });
});

describe("runMemoryQuery", () => {
  it("by_person returns matching events", () => {
    const r = runMemoryQuery(
      QueryCalendarMemoryInput.parse({ query_type: "by_person", query_string: "Leo" }),
      memoryPath,
    );
    expect(r.matches.length).toBe(1);
    expect(r.matches[0]?.uid).toBe("1");
    expect(r.total_in_memory).toBe(3);
  });

  it("by_topic matches keyword in title", () => {
    const r = runMemoryQuery(
      QueryCalendarMemoryInput.parse({ query_type: "by_topic", query_string: "exam" }),
      memoryPath,
    );
    expect(r.matches.length).toBe(1);
    expect(r.matches[0]?.uid).toBe("2");
  });

  it("by_date_range filters by start ts", () => {
    const r = runMemoryQuery(
      QueryCalendarMemoryInput.parse({
        query_type: "by_date_range",
        start_date: "2026-03-01T00:00:00Z",
        end_date: "2026-04-01T00:00:00Z",
      }),
      memoryPath,
    );
    expect(r.matches.length).toBe(1);
    expect(r.matches[0]?.uid).toBe("3");
  });

  it("by_calendar matches calendar name case-insensitively", () => {
    const r = runMemoryQuery(
      QueryCalendarMemoryInput.parse({ query_type: "by_calendar", calendar_name: "school" }),
      memoryPath,
    );
    expect(r.matches.length).toBe(1);
    expect(r.matches[0]?.uid).toBe("2");
  });

  it("similar_to ranks by token overlap", () => {
    const r = runMemoryQuery(
      QueryCalendarMemoryInput.parse({
        query_type: "similar_to",
        event: { title: "Lunch with Eleanor" },
        limit: 3,
      }),
      memoryPath,
    );
    expect(r.matches[0]?.uid).toBe("1");
  });

  it("all returns every event", () => {
    const r = runMemoryQuery(QueryCalendarMemoryInput.parse({ query_type: "all" }), memoryPath);
    expect(r.matches.length).toBe(3);
    expect(r.total_in_memory).toBe(3);
  });

  it("respects limit", () => {
    const r = runMemoryQuery(
      QueryCalendarMemoryInput.parse({ query_type: "all", limit: 2 }),
      memoryPath,
    );
    expect(r.matches.length).toBe(2);
  });
});
