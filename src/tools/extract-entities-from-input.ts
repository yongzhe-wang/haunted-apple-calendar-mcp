import { z } from "zod";

// Stage 1 of the YAPPING 9-stage pipeline.
//
// This tool does NOT itself parse anything. It returns a tight extraction
// schema + instructions that tell the calling LLM (Claude) exactly how to
// turn an arbitrary input description (Gmail screenshot, free text, URL
// summary, etc.) into structured events / people / topics / user statements
// + an inferred intent. Claude then issues follow-up tool calls
// (`update_memory_from_input`, `research_entities`, calendar mutations) with
// that structured payload.

export const ExtractEntitiesFromInputInput = z.object({
  input_description: z.string().min(1).max(8000),
  intent_hint: z
    .enum(["add_to_calendar", "move_event", "cancel", "query", "analyze", "enrich_only", "unknown"])
    .optional(),
});

type ExtractEntitiesFromInputArgs = z.infer<typeof ExtractEntitiesFromInputInput>;

interface ExtractEntitiesFromInputResult {
  extraction_schema: {
    events: { description: string };
    people: { description: string };
    topics: { description: string };
    user_statements: { description: string };
    intent: { description: string };
  };
  extraction_instructions: string;
  example_output: Record<string, unknown>;
}

const EXTRACTION_INSTRUCTIONS = [
  "Extract structured data from `input_description` per the schema below. Return ONE JSON object.",
  "1. events: zero or more calendar events. Each MUST include title, start (ISO 8601), end (ISO 8601), and calendar (best guess). Optional: notes, location, url.",
  "2. people: every named human in the input. Each MUST include name; optional role, relationship, email.",
  "3. topics: course codes, event types, locations, domains, clubs that recur or carry semantic weight. Each MUST include name; optional kind one of [course|event_type|location|domain|club|other].",
  "4. user_statements: verbatim quotes or paraphrased preferences/declarations the user makes about themselves, others, or topics. Use to track stable user beliefs.",
  "5. intent: one of [add_to_calendar|move_event|cancel|query|analyze|enrich_only|unknown]. Override `intent_hint` if the input clearly says otherwise.",
  "After extraction: call `research_entities` for any people/topics not yet known, then `update_memory_from_input` to persist. Do NOT fabricate: if a field is not in the input, omit it.",
].join("\n");

const EXAMPLE_OUTPUT: Record<string, unknown> = {
  events: [
    {
      title: "CIS 4600 Lecture",
      start: "2026-05-12T10:00:00-04:00",
      end: "2026-05-12T11:30:00-04:00",
      calendar: "School",
      location: "Towne 100",
    },
  ],
  people: [
    {
      name: "Lingjie Liu",
      role: "CIS prof",
      relationship: "professor",
    },
  ],
  topics: [
    {
      name: "CIS 4600",
      kind: "course",
    },
  ],
  user_statements: ["I prefer morning classes when possible."],
  intent: "add_to_calendar",
};

export async function extractEntitiesFromInput(
  args: ExtractEntitiesFromInputArgs,
): Promise<ExtractEntitiesFromInputResult> {
  // Async only to match the rest of the tool surface — the work itself is
  // pure schema construction.
  void args;
  return {
    extraction_schema: {
      events: {
        description:
          "Calendar events to add/move/cancel. Each: { title, start, end, calendar, notes?, location?, url? }.",
      },
      people: {
        description:
          "Named humans referenced in input. Each: { name, role?, relationship?, email? }.",
      },
      topics: {
        description:
          "Recurring concepts: courses, event types, locations, domains, clubs. Each: { name, kind? }.",
      },
      user_statements: {
        description:
          "Verbatim or paraphrased statements the user makes. Capture preferences and self-declarations.",
      },
      intent: {
        description:
          "One of: add_to_calendar | move_event | cancel | query | analyze | enrich_only | unknown.",
      },
    },
    extraction_instructions: EXTRACTION_INSTRUCTIONS,
    example_output: EXAMPLE_OUTPUT,
  };
}
