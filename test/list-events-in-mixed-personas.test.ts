import { describe, expect, it } from "vitest";
import {
  assignVoices,
  buildMixedPersonasResult,
  REWRITE_INSTRUCTIONS,
  seededShuffle,
} from "../src/tools/list-events-in-mixed-personas.js";
import type { CalendarEvent, ListEventsInMixedPersonasArgs } from "../src/types.js";
import { ListEventsInMixedPersonasInput } from "../src/types.js";
import { BUILT_IN_VOICES, type Voice } from "../src/voices.js";

const baseDates = {
  start_date: "2026-04-01T00:00:00Z",
  end_date: "2026-04-30T00:00:00Z",
};

function mkEvent(id: string, title: string, hourStart = 9): CalendarEvent {
  const day = Number.parseInt(id.replace(/\D/g, ""), 10) || 1;
  const dd = String(day).padStart(2, "0");
  const hh = String(hourStart).padStart(2, "0");
  return {
    id,
    title,
    start: `2026-04-${dd}T${hh}:00:00Z`,
    end: `2026-04-${dd}T${String(hourStart + 1).padStart(2, "0")}:00:00Z`,
    all_day: false,
    calendar_name: "Work",
  };
}

describe("BUILT_IN_VOICES", () => {
  it("has at least 30 voices", () => {
    expect(BUILT_IN_VOICES.length).toBeGreaterThanOrEqual(30);
  });

  it("every voice has a unique name", () => {
    const names = BUILT_IN_VOICES.map((v) => v.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("every voice directive is non-empty and ≤300 chars", () => {
    for (const v of BUILT_IN_VOICES) {
      expect(v.directive.length).toBeGreaterThan(20);
      expect(v.directive.length).toBeLessThanOrEqual(300);
    }
  });

  it("every voice directive instructs Claude to vary openers", () => {
    // Mirror of the persona Variation: regression test. Each voice must
    // contain "Vary"/"vary"/"≤30%"/"NO MORE THAN ONE LINE" or similar
    // variation guidance — voice constant, cadence rotates.
    const variationPattern = /var(y|ies|y openers)|rotate|≤30%|NO MORE THAN ONE LINE/i;
    for (const v of BUILT_IN_VOICES) {
      expect(v.directive, `${v.name} missing variation guidance`).toMatch(variationPattern);
    }
  });
});

describe("ListEventsInMixedPersonasInput", () => {
  it("applies default assignment_strategy='thematic' and seed=42", () => {
    const out = ListEventsInMixedPersonasInput.parse(baseDates);
    expect(out.assignment_strategy).toBe("thematic");
    expect(out.seed).toBe(42);
    expect(out.include_mortality).toBe(false);
  });

  it("rejects end_date <= start_date", () => {
    expect(() =>
      ListEventsInMixedPersonasInput.parse({
        start_date: "2026-04-30T00:00:00Z",
        end_date: "2026-04-01T00:00:00Z",
      }),
    ).toThrow();
  });

  it("requires ISO start_date and end_date", () => {
    expect(() =>
      ListEventsInMixedPersonasInput.parse({ start_date: "nope", end_date: baseDates.end_date }),
    ).toThrow();
  });

  it("accepts known assignment_strategy values", () => {
    for (const s of ["sequential", "shuffled", "thematic"] as const) {
      expect(() =>
        ListEventsInMixedPersonasInput.parse({ ...baseDates, assignment_strategy: s }),
      ).not.toThrow();
    }
  });

  it("rejects an unknown assignment_strategy", () => {
    expect(() =>
      ListEventsInMixedPersonasInput.parse({ ...baseDates, assignment_strategy: "random" }),
    ).toThrow();
  });

  it("rejects more than 20 calendars", () => {
    expect(() =>
      ListEventsInMixedPersonasInput.parse({
        ...baseDates,
        calendars: Array.from({ length: 21 }, (_, i) => `cal-${i}`),
      }),
    ).toThrow();
  });
});

describe("seededShuffle", () => {
  it("is deterministic for the same seed", () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(seededShuffle(arr, 42)).toEqual(seededShuffle(arr, 42));
  });

  it("returns a permutation (same elements)", () => {
    const arr = [1, 2, 3, 4, 5];
    const out = seededShuffle(arr, 7);
    expect(out.toSorted()).toEqual(arr.toSorted());
  });

  it("different seeds produce different orders for non-trivial arrays", () => {
    const arr = Array.from({ length: 20 }, (_, i) => i);
    expect(seededShuffle(arr, 1)).not.toEqual(seededShuffle(arr, 2));
  });

  it("does not mutate the input", () => {
    const arr = [1, 2, 3];
    const original = arr.slice();
    seededShuffle(arr, 42);
    expect(arr).toEqual(original);
  });
});

describe("assignVoices", () => {
  const tinyPool: Voice[] = [
    { name: "A", directive: "vary it", tags: ["lunch"] },
    { name: "B", directive: "vary it", tags: ["meeting"] },
    { name: "C", directive: "vary it", tags: ["exam"] },
  ];

  it("sequential cycles when pool < events", () => {
    const events = [mkEvent("1", "x"), mkEvent("2", "y"), mkEvent("3", "z"), mkEvent("4", "w")];
    const out = assignVoices(events, tinyPool, "sequential", 42);
    expect(out.get("1")?.name).toBe("A");
    expect(out.get("2")?.name).toBe("B");
    expect(out.get("3")?.name).toBe("C");
    expect(out.get("4")?.name).toBe("A");
  });

  it("shuffled uses every voice exactly once when pool >= events", () => {
    const events = [mkEvent("1", "x"), mkEvent("2", "y"), mkEvent("3", "z")];
    const out = assignVoices(events, tinyPool, "shuffled", 42);
    const names = events.map((e) => out.get(e.id)?.name);
    expect(new Set(names).size).toBe(3);
    expect(names.toSorted()).toEqual(["A", "B", "C"]);
  });

  it("thematic matches DMV-tagged events to Kafka, exam-tagged to Plath", () => {
    const events = [
      mkEvent("1", "Renew driver's license at the DMV"),
      mkEvent("2", "Calc II final exam"),
    ];
    const out = assignVoices(events, BUILT_IN_VOICES, "thematic", 42);
    expect(out.get("1")?.name).toBe("Kafka");
    // Plath is tagged "exam"; could also pick McCarthy/Marcus Aurelius. Verify
    // it's one of the exam-tagged voices.
    const examVoices = BUILT_IN_VOICES.filter((v) => v.tags?.includes("exam")).map((v) => v.name);
    expect(examVoices).toContain(out.get("2")?.name);
  });

  it("thematic falls back to shuffled when no tag matches", () => {
    const events = [mkEvent("1", "qwertyuiop"), mkEvent("2", "asdfghjkl")];
    const out = assignVoices(events, tinyPool, "thematic", 42);
    // Both events match nothing; both must still get a voice, distinct.
    expect(out.size).toBe(2);
    expect(out.get("1")?.name).not.toBe(out.get("2")?.name);
  });

  it("thematic gives every event a distinct voice when pool >= events", () => {
    const events = [
      mkEvent("1", "lunch with friends"),
      mkEvent("2", "team meeting"),
      mkEvent("3", "math exam"),
      mkEvent("4", "office hours"),
      mkEvent("5", "weekly check-in"),
    ];
    const out = assignVoices(events, BUILT_IN_VOICES, "thematic", 42);
    const names = events.map((e) => out.get(e.id)?.name);
    expect(new Set(names).size).toBe(5);
  });

  it("returns empty map for empty pool", () => {
    const events = [mkEvent("1", "x")];
    const out = assignVoices(events, [], "shuffled", 42);
    expect(out.size).toBe(0);
  });
});

describe("buildMixedPersonasResult", () => {
  const baseArgs: ListEventsInMixedPersonasArgs = {
    ...baseDates,
    assignment_strategy: "thematic",
    seed: 42,
    include_mortality: false,
  };

  it("returns the documented rewrite_instructions verbatim", () => {
    const out = buildMixedPersonasResult(baseArgs, []);
    expect(out.rewrite_instructions).toBe(REWRITE_INSTRUCTIONS);
  });

  it("voice_pool filter: rejects an unknown voice name", () => {
    expect(() =>
      buildMixedPersonasResult({ ...baseArgs, voice_pool: ["Hemingway", "NotARealVoice"] }, [
        mkEvent("1", "lunch"),
      ]),
    ).toThrow(/Unknown voice/);
  });

  it("voice_pool filter: restricts assignment to listed voices", () => {
    const events = [mkEvent("1", "x"), mkEvent("2", "y")];
    const out = buildMixedPersonasResult(
      { ...baseArgs, voice_pool: ["Hemingway", "Kafka"], assignment_strategy: "shuffled" },
      events,
    );
    const names = out.events.map((e) => e.voice_name).toSorted();
    expect(names).toEqual(["Hemingway", "Kafka"]);
    expect(out.voice_pool_size).toBe(2);
  });

  it("pool_exhausted_warning triggers when events > pool (non-sequential)", () => {
    const events = Array.from({ length: 5 }, (_, i) => mkEvent(String(i + 1), `evt-${i}`));
    const out = buildMixedPersonasResult(
      { ...baseArgs, voice_pool: ["Hemingway", "Kafka"], assignment_strategy: "shuffled" },
      events,
    );
    expect(out.pool_exhausted_warning).toBe(true);
  });

  it("pool_exhausted_warning is false for sequential strategy even when cycling", () => {
    const events = Array.from({ length: 5 }, (_, i) => mkEvent(String(i + 1), `evt-${i}`));
    const out = buildMixedPersonasResult(
      { ...baseArgs, voice_pool: ["Hemingway", "Kafka"], assignment_strategy: "sequential" },
      events,
    );
    expect(out.pool_exhausted_warning).toBe(false);
  });

  it("include_mortality: true attaches life_percent_consumed to each event", () => {
    const events = [mkEvent("1", "lunch", 9), mkEvent("2", "meeting", 14)];
    const out = buildMixedPersonasResult({ ...baseArgs, include_mortality: true }, events);
    for (const e of out.events) {
      expect(e.life_percent_consumed).toBeDefined();
      expect(typeof e.life_percent_consumed).toBe("number");
    }
  });

  it("include_mortality: false omits life_percent_consumed", () => {
    const events = [mkEvent("1", "lunch")];
    const out = buildMixedPersonasResult({ ...baseArgs, include_mortality: false }, events);
    expect(out.events[0]?.life_percent_consumed).toBeUndefined();
  });

  it("output shape: voices_used, voice_pool_size, assignment_strategy populated", () => {
    const events = [mkEvent("1", "lunch"), mkEvent("2", "meeting")];
    const out = buildMixedPersonasResult(baseArgs, events);
    expect(out.assignment_strategy).toBe("thematic");
    expect(out.voice_pool_size).toBe(BUILT_IN_VOICES.length);
    expect(out.voices_used.length).toBe(2);
    for (const e of out.events) {
      expect(e.voice_name).toBeTruthy();
      expect(e.voice_directive).toBeTruthy();
    }
  });

  it("sorts events chronologically by start", () => {
    const a = mkEvent("a", "later", 14);
    const b = mkEvent("b", "earlier", 9);
    const out = buildMixedPersonasResult(baseArgs, [a, b]);
    expect(out.events[0]?.id).toBe("b");
    expect(out.events[1]?.id).toBe("a");
  });
});
