import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  emptyMemory,
  getRelevantContextForEvent,
  isFactStale,
  loadMemory,
  mergeEvents,
  mergeExternalFacts,
  mergePeople,
  mergeTopics,
  mergeUserNotes,
  queryByCalendar,
  queryByDateRange,
  queryByPerson,
  queryByTopic,
  recentSimilarEvents,
  saveMemory,
  tokenize,
  type ExternalFact,
  type MemoryEvent,
  type MemoryFile,
  type PersonRecord,
  type TopicRecord,
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
    expect(out.version).toBe(2);
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
      version: 2,
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
    version: 2,
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
    version: 2,
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
    version: 2,
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

describe("mergePeople", () => {
  it("dedupes by lowercased name and unions appearances", () => {
    const m = emptyMemory();
    const p1: PersonRecord = {
      name: "Leo",
      first_seen: "2025-01-01T00:00:00Z",
      last_seen: "2025-06-01T00:00:00Z",
      appearances: ["a"],
    };
    const p2: PersonRecord = {
      name: "leo",
      first_seen: "2024-01-01T00:00:00Z",
      last_seen: "2026-01-01T00:00:00Z",
      appearances: ["b"],
    };
    const merged = mergePeople(mergePeople(m, [p1]), [p2]);
    expect(Object.keys(merged.people ?? {}).length).toBe(1);
    const rec = merged.people?.leo;
    expect(rec?.appearances.toSorted()).toEqual(["a", "b"]);
    expect(rec?.first_seen).toBe("2024-01-01T00:00:00Z");
    expect(rec?.last_seen).toBe("2026-01-01T00:00:00Z");
  });

  it("skips entries with empty name", () => {
    const m = emptyMemory();
    const merged = mergePeople(m, [
      {
        name: "",
        first_seen: "2025-01-01T00:00:00Z",
        last_seen: "2025-01-01T00:00:00Z",
        appearances: [],
      },
    ]);
    expect(Object.keys(merged.people ?? {}).length).toBe(0);
  });
});

describe("mergeTopics", () => {
  it("sums appearance_count and unions related_people", () => {
    const m = emptyMemory();
    const t1: TopicRecord = {
      name: "CIS 4600",
      kind: "course",
      first_seen: "2026-01-01T00:00:00Z",
      last_seen: "2026-04-01T00:00:00Z",
      appearance_count: 2,
      related_people: ["Lingjie Liu"],
    };
    const t2: TopicRecord = {
      name: "cis 4600",
      first_seen: "2025-12-01T00:00:00Z",
      last_seen: "2026-05-01T00:00:00Z",
      appearance_count: 3,
      related_people: ["TA"],
    };
    const merged = mergeTopics(mergeTopics(m, [t1]), [t2]);
    const rec = merged.topics?.["cis 4600"];
    expect(rec?.appearance_count).toBe(5);
    expect(rec?.related_people?.toSorted()).toEqual(["Lingjie Liu", "TA"]);
    expect(rec?.first_seen).toBe("2025-12-01T00:00:00Z");
  });
});

describe("mergeUserNotes", () => {
  it("appends notes verbatim and skips empty text", () => {
    const m = emptyMemory();
    const merged = mergeUserNotes(m, [
      { text: "I like mornings", ts: "2026-04-01T00:00:00Z" },
      { text: "  ", ts: "2026-04-02T00:00:00Z" },
    ]);
    expect(merged.user_notes?.length).toBe(1);
    expect(merged.user_notes?.[0]?.text).toBe("I like mornings");
  });
});

describe("mergeExternalFacts", () => {
  it("overwrites when newer or more confident", () => {
    const m = emptyMemory();
    const old: ExternalFact = {
      entity: "Leo",
      kind: "person",
      summary: "old",
      sources: [],
      confidence: 0.5,
      cached_at: "2026-01-01T00:00:00Z",
      ttl_days: 7,
    };
    const fresh: ExternalFact = {
      entity: "Leo",
      kind: "person",
      summary: "new",
      sources: [],
      confidence: 0.5,
      cached_at: "2026-04-01T00:00:00Z",
      ttl_days: 7,
    };
    const merged = mergeExternalFacts(mergeExternalFacts(m, [old]), [fresh]);
    expect(merged.external_facts?.leo?.summary).toBe("new");
  });

  it("keeps older entry when incoming is older AND less confident", () => {
    const m = emptyMemory();
    const newer: ExternalFact = {
      entity: "Leo",
      kind: "person",
      summary: "kept",
      sources: [],
      confidence: 0.9,
      cached_at: "2026-04-01T00:00:00Z",
      ttl_days: 7,
    };
    const older: ExternalFact = {
      entity: "Leo",
      kind: "person",
      summary: "dropped",
      sources: [],
      confidence: 0.4,
      cached_at: "2026-01-01T00:00:00Z",
      ttl_days: 7,
    };
    const merged = mergeExternalFacts(mergeExternalFacts(m, [newer]), [older]);
    expect(merged.external_facts?.leo?.summary).toBe("kept");
  });
});

describe("isFactStale", () => {
  it("fresh fact within TTL is not stale", () => {
    const fact: ExternalFact = {
      entity: "x",
      kind: "topic",
      summary: "y",
      sources: [],
      confidence: 0.5,
      cached_at: new Date().toISOString(),
      ttl_days: 7,
    };
    expect(isFactStale(fact)).toBe(false);
  });

  it("fact older than TTL is stale", () => {
    const fact: ExternalFact = {
      entity: "x",
      kind: "topic",
      summary: "y",
      sources: [],
      confidence: 0.5,
      cached_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      ttl_days: 7,
    };
    expect(isFactStale(fact)).toBe(true);
  });

  it("treats invalid cached_at as stale", () => {
    const fact: ExternalFact = {
      entity: "x",
      kind: "topic",
      summary: "y",
      sources: [],
      confidence: 0.5,
      cached_at: "not-a-date",
      ttl_days: 7,
    };
    expect(isFactStale(fact)).toBe(true);
  });
});

describe("getRelevantContextForEvent", () => {
  const baseMemory: MemoryFile = {
    version: 2,
    last_updated: "2026-04-01T00:00:00Z",
    events: [
      {
        uid: "u1",
        title: "lunch with leo",
        start: "2026-03-01T12:00:00Z",
        end: "2026-03-01T13:00:00Z",
        duration_hours: 1,
        calendar: "Work",
      },
    ],
    people: {
      leo: {
        name: "Leo",
        first_seen: "2025-01-01T00:00:00Z",
        last_seen: "2026-03-01T13:00:00Z",
        appearances: ["u1"],
      },
    },
    topics: {
      lunch: {
        name: "lunch",
        kind: "event_type",
        first_seen: "2025-01-01T00:00:00Z",
        last_seen: "2026-03-01T13:00:00Z",
        appearance_count: 5,
      },
    },
    user_notes: [{ text: "I prefer lunch over dinner", ts: "2026-04-01T00:00:00Z" }],
    external_facts: {
      leo: {
        entity: "Leo",
        kind: "person",
        summary: "Leo is a friend.",
        sources: [],
        confidence: 0.8,
        cached_at: new Date().toISOString(),
        ttl_days: 7,
      },
    },
  };

  it("surfaces all five context categories for a matching event", () => {
    const ctx = getRelevantContextForEvent(baseMemory, {
      title: "lunch with leo",
      calendar: "Work",
    });
    expect(ctx.memory_context_items.length).toBeGreaterThan(0);
    expect(ctx.people_context.some((p) => p.name === "Leo")).toBe(true);
    expect(ctx.topic_context.some((t) => t.name === "lunch")).toBe(true);
    expect(ctx.external_facts.some((f) => f.entity === "Leo")).toBe(true);
    expect(ctx.user_notes_relevant.length).toBeGreaterThan(0);
  });

  it("returns empty arrays when nothing matches", () => {
    const ctx = getRelevantContextForEvent(baseMemory, {
      title: "qwertyuiop",
      calendar: "X",
    });
    expect(ctx.memory_context_items).toEqual([]);
    expect(ctx.people_context).toEqual([]);
    expect(ctx.topic_context).toEqual([]);
    expect(ctx.external_facts).toEqual([]);
  });

  it("respects include_user_notes=false", () => {
    const ctx = getRelevantContextForEvent(
      baseMemory,
      { title: "lunch with leo" },
      { include_user_notes: false },
    );
    expect(ctx.user_notes_relevant).toEqual([]);
  });

  it("respects top_n caps", () => {
    const ctx = getRelevantContextForEvent(
      baseMemory,
      { title: "lunch with leo", calendar: "Work" },
      { top_n_memory: 0, top_n_people: 0, top_n_topics: 0 },
    );
    expect(ctx.memory_context_items).toEqual([]);
    expect(ctx.people_context).toEqual([]);
    expect(ctx.topic_context).toEqual([]);
  });
});
