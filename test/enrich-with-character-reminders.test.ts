import { describe, expect, it } from "vitest";
import { BUILT_IN_CHARACTERS } from "../src/characters.js";
import { emptyMemory, type MemoryFile } from "../src/memory.js";
import {
  REWRITE_TEMPLATE,
  assignCharacters,
  buildEnrichmentResult,
} from "../src/tools/enrich-with-character-reminders.js";
import type { CalendarEvent, EnrichWithCharacterRemindersArgs } from "../src/types.js";
import { EnrichWithCharacterRemindersInput } from "../src/types.js";

const baseDates = {
  start_date: "2026-04-01T00:00:00Z",
  end_date: "2026-04-30T00:00:00Z",
};

function mkEvent(id: string, title: string, hour = 9): CalendarEvent {
  const day = Number.parseInt(id.replace(/\D/g, ""), 10) || 1;
  const dd = String(day).padStart(2, "0");
  const hh = String(hour).padStart(2, "0");
  return {
    id,
    title,
    start: `2026-04-${dd}T${hh}:00:00Z`,
    end: `2026-04-${dd}T${String(hour + 1).padStart(2, "0")}:00:00Z`,
    all_day: false,
    calendar_name: "Work",
  };
}

describe("EnrichWithCharacterRemindersInput", () => {
  it("applies sensible defaults", () => {
    const out = EnrichWithCharacterRemindersInput.parse(baseDates);
    expect(out.include_memory_context).toBe(true);
    expect(out.memory_context_size).toBe(3);
    expect(out.seed).toBe(42);
  });

  it("rejects end_date <= start_date", () => {
    expect(() =>
      EnrichWithCharacterRemindersInput.parse({
        start_date: "2026-04-30T00:00:00Z",
        end_date: "2026-04-01T00:00:00Z",
      }),
    ).toThrow();
  });

  it("rejects unknown character names", () => {
    expect(() =>
      EnrichWithCharacterRemindersInput.parse({
        ...baseDates,
        character_pool: ["NotARealCharacter"],
      }),
    ).toThrow();
  });
});

describe("assignCharacters", () => {
  it("assigns by trigger overlap", () => {
    const events = [mkEvent("1", "Lunch with Leo"), mkEvent("2", "Workout at the gym")];
    const out = assignCharacters(events, BUILT_IN_CHARACTERS, 42);
    // workout/gym is in Coach triggers
    expect(out.get("2")?.name).toBe("Coach");
  });

  it("falls back to deterministic cycle when no trigger overlap", () => {
    const events = [mkEvent("1", "qwertyuiop"), mkEvent("2", "asdfghjkl")];
    const out = assignCharacters(events, BUILT_IN_CHARACTERS, 42);
    expect(out.get("1")).toBeDefined();
    expect(out.get("2")).toBeDefined();
  });

  it("returns empty map for empty pool or empty events", () => {
    expect(assignCharacters([], BUILT_IN_CHARACTERS, 42).size).toBe(0);
    expect(assignCharacters([mkEvent("1", "x")], [], 42).size).toBe(0);
  });
});

describe("buildEnrichmentResult", () => {
  const baseArgs: EnrichWithCharacterRemindersArgs = {
    ...baseDates,
    include_memory_context: true,
    memory_context_size: 3,
    seed: 42,
  };

  it("returns the documented rewrite_template verbatim", () => {
    const out = buildEnrichmentResult({ args: baseArgs, events: [], memory: emptyMemory() });
    expect(out.rewrite_template).toBe(REWRITE_TEMPLATE);
  });

  it("attaches memory_context when include_memory_context=true", () => {
    const memory: MemoryFile = {
      version: 1,
      last_updated: "2026-04-01T00:00:00Z",
      events: [
        {
          uid: "old1",
          title: "lunch with leo",
          start: "2026-03-15T12:00:00Z",
          end: "2026-03-15T13:00:00Z",
          duration_hours: 1,
          calendar: "Work",
        },
      ],
    };
    const out = buildEnrichmentResult({
      args: baseArgs,
      events: [mkEvent("e1", "lunch with leo and eleanor")],
      memory,
    });
    expect(out.events[0]?.memory_context.length).toBeGreaterThan(0);
    expect(out.events[0]?.memory_context[0]?.uid).toBe("old1");
  });

  it("memory_context is empty when include_memory_context=false", () => {
    const out = buildEnrichmentResult({
      args: { ...baseArgs, include_memory_context: false },
      events: [mkEvent("e1", "lunch with leo")],
      memory: emptyMemory(),
    });
    expect(out.events[0]?.memory_context).toEqual([]);
  });

  it("memory_context_size=0 disables context even when flag is true", () => {
    const out = buildEnrichmentResult({
      args: { ...baseArgs, memory_context_size: 0 },
      events: [mkEvent("e1", "lunch with leo")],
      memory: emptyMemory(),
    });
    expect(out.events[0]?.memory_context).toEqual([]);
  });

  it("characters_used is non-empty and each event has a character", () => {
    const out = buildEnrichmentResult({
      args: baseArgs,
      events: [mkEvent("1", "lunch"), mkEvent("2", "workout")],
      memory: emptyMemory(),
    });
    expect(out.characters_used.length).toBeGreaterThan(0);
    for (const e of out.events) {
      expect(e.character_label).toBeTruthy();
      expect(e.character_directive).toBeTruthy();
      expect(e.rewrite_instruction).toBeTruthy();
    }
  });

  it("sorts events chronologically", () => {
    const a = mkEvent("a", "later", 14);
    const b = mkEvent("b", "earlier", 9);
    const out = buildEnrichmentResult({
      args: baseArgs,
      events: [a, b],
      memory: emptyMemory(),
    });
    expect(out.events[0]?.id).toBe("b");
  });

  it("character_pool restricts to listed characters", () => {
    const out = buildEnrichmentResult({
      args: { ...baseArgs, character_pool: ["Mom", "Friend"] },
      events: [mkEvent("1", "lunch"), mkEvent("2", "workout")],
      memory: emptyMemory(),
    });
    for (const e of out.events) {
      expect(["Mom", "Friend"]).toContain(
        BUILT_IN_CHARACTERS.find((c) => c.short_label === e.character_label)?.name,
      );
    }
  });
});
