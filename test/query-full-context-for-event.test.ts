import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveMemory, type MemoryFile } from "../src/memory.js";
import {
  QueryFullContextForEventInput,
  queryFullContextForEvent,
} from "../src/tools/query-full-context-for-event.js";

let workdir = "";
let memoryPath = "";

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "yu-qfc-"));
  memoryPath = join(workdir, "memory.json");
});

afterEach(() => {
  if (workdir) {
    rmSync(workdir, { recursive: true, force: true });
  }
});

describe("QueryFullContextForEventInput schema", () => {
  it("requires event_uid OR event_inline", () => {
    expect(() => QueryFullContextForEventInput.parse({})).toThrow();
  });

  it("accepts event_uid", () => {
    expect(() => QueryFullContextForEventInput.parse({ event_uid: "abc" })).not.toThrow();
  });

  it("accepts event_inline", () => {
    expect(() =>
      QueryFullContextForEventInput.parse({ event_inline: { title: "lunch" } }),
    ).not.toThrow();
  });

  it("applies sensible defaults", () => {
    const out = QueryFullContextForEventInput.parse({ event_uid: "x" });
    expect(out.top_n_memory).toBe(3);
    expect(out.top_n_people).toBe(5);
    expect(out.top_n_topics).toBe(3);
    expect(out.top_n_user_notes).toBe(5);
    expect(out.include_user_notes).toBe(true);
  });
});

describe("queryFullContextForEvent", () => {
  it("returns empty bundle when memory is empty (inline event)", async () => {
    const out = await queryFullContextForEvent(
      QueryFullContextForEventInput.parse({ event_inline: { title: "first time" } }),
      memoryPath,
    );
    expect(out.event.title).toBe("first time");
    expect(out.memory_context_items).toEqual([]);
    expect(out.people_context).toEqual([]);
    expect(out.topic_context).toEqual([]);
    expect(out.external_facts).toEqual([]);
    expect(out.user_notes_relevant).toEqual([]);
  });

  it("surfaces matching person + fact + memory event for an inline event", async () => {
    const memory: MemoryFile = {
      version: 2,
      last_updated: "2026-04-01T00:00:00Z",
      events: [
        {
          uid: "u1",
          title: "lunch with leo",
          start: "2026-03-15T12:00:00Z",
          end: "2026-03-15T13:00:00Z",
          duration_hours: 1,
          calendar: "Work",
        },
      ],
      people: {
        leo: {
          name: "Leo",
          relationship: "friend",
          first_seen: "2025-01-01T00:00:00Z",
          last_seen: "2026-03-15T13:00:00Z",
          appearances: ["u1"],
        },
      },
      topics: {},
      user_notes: [],
      external_facts: {
        leo: {
          entity: "Leo",
          kind: "person",
          summary: "Leo is a long-time friend.",
          sources: [],
          confidence: 0.8,
          cached_at: new Date().toISOString(),
          ttl_days: 7,
        },
      },
    };
    saveMemory(memory, memoryPath);
    const out = await queryFullContextForEvent(
      QueryFullContextForEventInput.parse({
        event_inline: { title: "lunch with leo and eleanor", calendar: "Work" },
      }),
      memoryPath,
    );
    expect(out.memory_context_items.length).toBeGreaterThan(0);
    expect(out.people_context.some((p) => p.name === "Leo")).toBe(true);
    expect(out.external_facts.some((f) => f.entity === "Leo")).toBe(true);
  });

  it("resolves event_uid from memory.events", async () => {
    const memory: MemoryFile = {
      version: 2,
      last_updated: "2026-04-01T00:00:00Z",
      events: [
        {
          uid: "u1",
          title: "team review",
          start: "2026-04-01T09:00:00Z",
          end: "2026-04-01T10:00:00Z",
          duration_hours: 1,
          calendar: "Work",
        },
      ],
    };
    saveMemory(memory, memoryPath);
    const out = await queryFullContextForEvent(
      QueryFullContextForEventInput.parse({ event_uid: "u1" }),
      memoryPath,
    );
    expect(out.event.uid).toBe("u1");
    expect(out.event.title).toBe("team review");
  });
});
