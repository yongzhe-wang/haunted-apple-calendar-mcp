import { describe, expect, it } from "vitest";
import { BUILT_IN_PERSONA_NAMES, BUILT_IN_PERSONAS, getPersonaDirective } from "../src/personas.js";
import { buildPersonaResult, REWRITE_INSTRUCTIONS } from "../src/tools/list-events-in-persona.js";
import type { CalendarEvent, ListEventsInPersonaArgs } from "../src/types.js";
import { ListEventsInPersonaInput } from "../src/types.js";

describe("BUILT_IN_PERSONAS", () => {
  it("every persona returns a non-empty directive", () => {
    for (const name of Object.keys(BUILT_IN_PERSONAS) as (keyof typeof BUILT_IN_PERSONAS)[]) {
      const directive = getPersonaDirective(name);
      expect(directive).toBeTruthy();
      expect(directive.length).toBeGreaterThan(20);
    }
  });

  it("every built-in persona directive includes a Variation: clause", () => {
    for (const name of BUILT_IN_PERSONA_NAMES) {
      expect(BUILT_IN_PERSONAS[name]).toContain("Variation:");
    }
  });

  it("includes the six expected personas", () => {
    expect(Object.keys(BUILT_IN_PERSONAS).toSorted()).toEqual(
      [
        "anxious_golden_retriever",
        "asian_mom",
        "four_year_old",
        "hemingway",
        "marcus_aurelius",
        "werner_herzog",
      ].toSorted(),
    );
  });
});

describe("ListEventsInPersonaInput", () => {
  const baseDates = {
    start_date: "2026-04-01T00:00:00Z",
    end_date: "2026-04-30T00:00:00Z",
  };

  it("accepts a built-in persona without custom_directive", () => {
    expect(() =>
      ListEventsInPersonaInput.parse({ persona: "hemingway", ...baseDates }),
    ).not.toThrow();
  });

  it("rejects an unknown persona enum value", () => {
    expect(() =>
      ListEventsInPersonaInput.parse({ persona: "shakespeare", ...baseDates }),
    ).toThrow();
  });

  it("requires custom_directive when persona='custom'", () => {
    expect(() => ListEventsInPersonaInput.parse({ persona: "custom", ...baseDates })).toThrow();
  });

  it("rejects an empty custom_directive when persona='custom'", () => {
    expect(() =>
      ListEventsInPersonaInput.parse({
        persona: "custom",
        custom_directive: "   ",
        ...baseDates,
      }),
    ).toThrow();
  });

  it("accepts a non-empty custom_directive when persona='custom'", () => {
    const out = ListEventsInPersonaInput.parse({
      persona: "custom",
      custom_directive: "Speak only in haikus.",
      ...baseDates,
    });
    expect(out.persona).toBe("custom");
    expect(out.custom_directive).toBe("Speak only in haikus.");
  });

  it("accepts an optional calendars filter", () => {
    const out = ListEventsInPersonaInput.parse({
      persona: "werner_herzog",
      calendars: ["Work", "Home"],
      ...baseDates,
    });
    expect(out.calendars).toEqual(["Work", "Home"]);
  });

  it("requires ISO dates", () => {
    expect(() =>
      ListEventsInPersonaInput.parse({
        persona: "hemingway",
        start_date: "not-a-date",
        end_date: "2026-04-30T00:00:00Z",
      }),
    ).toThrow();
  });

  it("rejects more than 20 calendars", () => {
    expect(() =>
      ListEventsInPersonaInput.parse({
        persona: "hemingway",
        ...baseDates,
        calendars: Array.from({ length: 21 }, (_, i) => `cal-${i}`),
      }),
    ).toThrow();
  });

  it("accepts exactly 20 calendars (boundary)", () => {
    expect(() =>
      ListEventsInPersonaInput.parse({
        persona: "hemingway",
        ...baseDates,
        calendars: Array.from({ length: 20 }, (_, i) => `cal-${i}`),
      }),
    ).not.toThrow();
  });

  it("rejects custom_directive longer than 4000 chars", () => {
    expect(() =>
      ListEventsInPersonaInput.parse({
        persona: "custom",
        custom_directive: "x".repeat(4001),
        ...baseDates,
      }),
    ).toThrow();
  });

  it("accepts custom_directive of exactly 4000 chars (boundary)", () => {
    expect(() =>
      ListEventsInPersonaInput.parse({
        persona: "custom",
        custom_directive: "x".repeat(4000),
        ...baseDates,
      }),
    ).not.toThrow();
  });
});

describe("TimePerCalendarInput size caps", () => {
  it("rejects more than 64 exclude_calendars", async () => {
    const { TimePerCalendarInput } = await import("../src/types.js");
    expect(() =>
      TimePerCalendarInput.parse({
        start_date: "2026-04-01T00:00:00Z",
        end_date: "2026-04-30T00:00:00Z",
        exclude_calendars: Array.from({ length: 65 }, (_, i) => `cal-${i}`),
      }),
    ).toThrow();
  });

  it("rejects an exclude_calendars entry longer than 256 chars", async () => {
    const { TimePerCalendarInput } = await import("../src/types.js");
    expect(() =>
      TimePerCalendarInput.parse({
        start_date: "2026-04-01T00:00:00Z",
        end_date: "2026-04-30T00:00:00Z",
        exclude_calendars: ["x".repeat(257)],
      }),
    ).toThrow();
  });

  it("accepts 64 exclude_calendars with 256-char names (boundary)", async () => {
    const { TimePerCalendarInput } = await import("../src/types.js");
    expect(() =>
      TimePerCalendarInput.parse({
        start_date: "2026-04-01T00:00:00Z",
        end_date: "2026-04-30T00:00:00Z",
        exclude_calendars: Array.from({ length: 64 }, () => "x".repeat(256)),
      }),
    ).not.toThrow();
  });
});

describe("Persona enum derivation", () => {
  it("zod enum includes every built-in persona key", () => {
    for (const name of BUILT_IN_PERSONA_NAMES) {
      expect(() =>
        ListEventsInPersonaInput.parse({
          persona: name,
          start_date: "2026-04-01T00:00:00Z",
          end_date: "2026-04-30T00:00:00Z",
        }),
      ).not.toThrow();
    }
  });

  it("BUILT_IN_PERSONA_NAMES matches Object.keys(BUILT_IN_PERSONAS)", () => {
    expect(BUILT_IN_PERSONA_NAMES.toSorted()).toEqual(Object.keys(BUILT_IN_PERSONAS).toSorted());
  });
});

describe("buildPersonaResult", () => {
  const baseArgs: ListEventsInPersonaArgs = {
    persona: "hemingway",
    start_date: "2026-04-01T00:00:00Z",
    end_date: "2026-04-30T00:00:00Z",
  };
  const sampleEvents: CalendarEvent[] = [
    {
      id: "evt-1",
      title: "Standup",
      start: "2026-04-01T09:00:00Z",
      end: "2026-04-01T09:30:00Z",
      all_day: false,
      calendar_name: "Work",
    },
    {
      id: "evt-2",
      title: "Lunch",
      start: "2026-04-01T12:00:00Z",
      end: "2026-04-01T13:00:00Z",
      all_day: false,
      calendar_name: "Personal",
    },
  ];

  it("resolves a built-in persona to BUILT_IN_PERSONAS[name]", () => {
    const out = buildPersonaResult({ ...baseArgs, persona: "hemingway" }, []);
    expect(out.persona_directive).toBe(BUILT_IN_PERSONAS.hemingway);
  });

  it("trims a custom directive", () => {
    const out = buildPersonaResult(
      { ...baseArgs, persona: "custom", custom_directive: "  Speak in haikus.  " },
      [],
    );
    expect(out.persona_directive).toBe("Speak in haikus.");
  });

  it("passes events through unmutated", () => {
    const out = buildPersonaResult(baseArgs, sampleEvents);
    // Referential equality: the helper must not copy/mutate the array.
    expect(out.events).toBe(sampleEvents);
    expect(out.events).toHaveLength(2);
    expect(out.events[0]?.id).toBe("evt-1");
    expect(out.events[1]?.id).toBe("evt-2");
  });

  it("returns the documented rewrite_instructions verbatim", () => {
    const out = buildPersonaResult(baseArgs, []);
    expect(out.rewrite_instructions).toBe(REWRITE_INSTRUCTIONS);
  });

  it("sets persona_name to the input persona literal", () => {
    const out = buildPersonaResult({ ...baseArgs, persona: "marcus_aurelius" }, []);
    expect(out.persona_name).toBe("marcus_aurelius");
    const customOut = buildPersonaResult(
      { ...baseArgs, persona: "custom", custom_directive: "Be brief." },
      [],
    );
    expect(customOut.persona_name).toBe("custom");
  });

  it("each built-in persona resolves to a non-empty directive", () => {
    for (const name of BUILT_IN_PERSONA_NAMES) {
      const out = buildPersonaResult({ ...baseArgs, persona: name }, []);
      expect(out.persona_directive).toBeTruthy();
      expect(out.persona_directive.length).toBeGreaterThan(20);
    }
  });
});
