import { describe, expect, it } from "vitest";
import { BUILT_IN_DISTILLERS, type Distiller } from "../src/distillers.js";
import { emptyMemory } from "../src/memory.js";
import { buildDistillVoiceResult } from "../src/tools/distill-voice-from-text.js";
import { buildEnrichmentResult } from "../src/tools/enrich-with-character-reminders.js";
import { DistillVoiceFromTextInput } from "../src/types.js";
import type { CalendarEvent, EnrichWithCharacterRemindersArgs } from "../src/types.js";

const baseDates = {
  start_date: "2026-04-01T00:00:00Z",
  end_date: "2026-04-30T00:00:00Z",
};

const baseArgs: EnrichWithCharacterRemindersArgs = {
  ...baseDates,
  include_memory_context: true,
  memory_context_size: 3,
  seed: 42,
  use_persistent_config: true,
};

function mkEvent(id: string, title: string): CalendarEvent {
  return {
    id,
    title,
    start: "2026-04-10T09:00:00Z",
    end: "2026-04-10T10:00:00Z",
    all_day: false,
    calendar_name: "Work",
  };
}

describe("enrich_with_character_reminders + distillers", () => {
  it("accepts distiller_pool arg and assigns named distillers", () => {
    const out = buildEnrichmentResult({
      args: { ...baseArgs, distiller_pool: ["Garry Tan"] },
      events: [mkEvent("1", "demo day prep")],
      memory: emptyMemory(),
    });
    expect(out.events[0]?.character_label).toBe("Garry");
    expect(out.events[0]?.distiller_attribution).toMatch(/synthetic/i);
    expect(out.events[0]?.distiller_signature_phrases?.length).toBeGreaterThan(0);
    expect(out.characters_used).toContain("Garry Tan");
  });

  it("characters and distillers merge into a single pool by default", () => {
    const out = buildEnrichmentResult({
      args: baseArgs,
      events: [mkEvent("1", "lunch"), mkEvent("2", "demo")],
      memory: emptyMemory(),
    });
    // Pool should include built-in characters AND distillers — at least one
    // event must end up with a known distiller or character.
    expect(out.events.length).toBe(2);
    for (const e of out.events) {
      expect(e.character_label).toBeTruthy();
    }
  });

  it("inline custom_distillers override built-in distiller of same name", () => {
    const inline: Distiller[] = [
      {
        name: "Naval Ravikant",
        short_label: "MyNaval",
        directive:
          "Inline override. Variation: rotate. Reference memory_context. Synthetic voice; not endorsed.",
        attribution: "Synthetic voice. Not endorsed by Naval.",
        signature_phrases: ["leverage", "specific knowledge", "compounding"],
        worldview_tags: ["founder"],
      },
    ];
    const out = buildEnrichmentResult({
      args: {
        ...baseArgs,
        distiller_pool: ["Naval Ravikant"],
        custom_distillers: inline,
      },
      events: [mkEvent("1", "leverage review")],
      memory: emptyMemory(),
    });
    expect(out.events[0]?.character_label).toBe("MyNaval");
  });

  it("throws on unknown distiller_pool name", () => {
    expect(() =>
      buildEnrichmentResult({
        args: { ...baseArgs, distiller_pool: ["NotAVoice"] },
        events: [mkEvent("1", "x")],
        memory: emptyMemory(),
      }),
    ).toThrow(/Unknown distiller name/);
  });

  it("character_pool and distiller_pool can be combined", () => {
    const out = buildEnrichmentResult({
      args: {
        ...baseArgs,
        character_pool: ["Coach"],
        distiller_pool: ["Garry Tan"],
      },
      events: [mkEvent("1", "workout"), mkEvent("2", "demo day")],
      memory: emptyMemory(),
    });
    const labels = out.events.map((e) => e.character_label);
    expect(labels).toContain("Coach");
    expect(labels).toContain("Garry");
  });

  it("plain Character has no distiller fields populated", () => {
    const out = buildEnrichmentResult({
      args: { ...baseArgs, character_pool: ["Mom"] },
      events: [mkEvent("1", "lunch")],
      memory: emptyMemory(),
    });
    expect(out.events[0]?.distiller_attribution).toBeUndefined();
    expect(out.events[0]?.distiller_signature_phrases).toBeUndefined();
  });

  it("every built-in distiller is selectable by name", () => {
    for (const d of BUILT_IN_DISTILLERS) {
      const out = buildEnrichmentResult({
        args: { ...baseArgs, distiller_pool: [d.name] },
        events: [mkEvent("1", "ambient")],
        memory: emptyMemory(),
      });
      expect(out.events[0]?.character_label).toBe(d.short_label);
    }
  });
});

describe("distill_voice_from_text", () => {
  it("validates min corpus length", () => {
    expect(() =>
      DistillVoiceFromTextInput.parse({
        name: "X",
        short_label: "X",
        corpus_text: "too short",
      }),
    ).toThrow();
  });

  it("returns a draft distiller with synthetic-voice attribution", () => {
    const args = DistillVoiceFromTextInput.parse({
      name: "Yongzhe",
      short_label: "YZ",
      corpus_text:
        "I tend to write in clipped sentences. I default to action verbs. I distrust adjectives. The point is the punch.",
      worldview_tags: ["founder"],
      triggers: ["weekly"],
    });
    const out = buildDistillVoiceResult(args);
    expect(out.draft_distiller.name).toBe("Yongzhe");
    expect(out.draft_distiller.attribution).toMatch(/synthetic/i);
    expect(out.draft_distiller.directive).toMatch(/PLACEHOLDER/);
    expect(out.draft_distiller.signature_phrases).toEqual([]);
    expect(out.corpus_text).toBe(args.corpus_text);
    expect(out.generation_instructions).toMatch(/Variation/);
    expect(out.generation_instructions).toMatch(/memory_context/);
  });
});
