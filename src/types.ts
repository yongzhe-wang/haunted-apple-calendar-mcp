import { z } from "zod";
import { BUILT_IN_PERSONA_NAMES } from "./personas.js";

const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), {
  message: "Must be a valid ISO 8601 date string",
});

export const CalendarInfoSchema = z.object({
  name: z.string(),
  writable: z.boolean(),
});

export const EventSchema = z.object({
  id: z.string(),
  title: z.string(),
  start: z.string(),
  end: z.string(),
  all_day: z.boolean(),
  location: z.string().optional(),
  notes: z.string().optional(),
  calendar_name: z.string(),
  url: z.string().optional(),
  // Raw iCal RRULE string from Calendar.app when the event is recurring;
  // omitted for one-off events. Surfaces so downstream tools can reason
  // about recurrence (e.g. mortality_overlay weighting future occurrences)
  // and so the bug-fix (0.6.2) is observable to callers.
  recurrence_rule: z.string().optional(),
});

export type CalendarInfo = z.infer<typeof CalendarInfoSchema>;
export type CalendarEvent = z.infer<typeof EventSchema>;

export const ListEventsInput = z.object({
  start_date: isoDate,
  end_date: isoDate,
  calendar_name: z.string().optional(),
  limit: z.number().int().min(1).max(500).default(100),
});

export const SearchEventsInput = z.object({
  query: z.string().min(1),
  start_date: isoDate.optional(),
  end_date: isoDate.optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const CreateEventInput = z.object({
  title: z.string().min(1),
  start_date: isoDate,
  end_date: isoDate,
  calendar_name: z.string().optional(),
  location: z.string().optional(),
  notes: z.string().optional(),
  url: z.string().optional(),
  all_day: z.boolean().optional(),
});

export const UpdateEventInput = z.object({
  event_id: z.string().min(1),
  title: z.string().optional(),
  start_date: isoDate.optional(),
  end_date: isoDate.optional(),
  calendar_name: z.string().optional(),
  location: z.string().optional(),
  notes: z.string().optional(),
  url: z.string().optional(),
  all_day: z.boolean().optional(),
});

export const DeleteEventInput = z.object({
  event_id: z.string().min(1),
});

// Defaults intentionally include common read-only / noisy calendars so the
// "time spent" answer reflects how the user actually allocated time, not how
// many holidays or birthdays Apple decided to inject.
export const DEFAULT_EXCLUDED_CALENDARS = [
  "Holidays in United States",
  "中国大陆节假日",
  "US Holidays",
  "Birthdays",
  "Siri Suggestions",
  "Scheduled Reminders",
] as const;

// Size caps on free-form arrays / strings that flow into AppleScript. Caps
// keep a hostile or buggy caller from triggering huge fan-outs or 16MB-buffer
// blowups via osascript. Values are generous vs. realistic usage.
export const TimePerCalendarInputObject = z.object({
  start_date: isoDate,
  end_date: isoDate,
  exclude_calendars: z.array(z.string().max(256)).max(64).optional(),
  skip_allday: z.boolean().default(true),
});

export const TimePerCalendarInput = TimePerCalendarInputObject.refine(
  (v) => Date.parse(v.end_date) > Date.parse(v.start_date),
  {
    message: "end_date must be strictly after start_date",
    path: ["end_date"],
  },
);

export const TimePerCalendarBucketSchema = z.object({
  name: z.string(),
  timed_seconds: z.number(),
  timed_event_count: z.number().int(),
  allday_event_count: z.number().int(),
  pct_of_window: z.number(),
});

export const TimePerCalendarOutput = z.object({
  as_of: z.string(),
  window: z.object({
    start: z.string(),
    end: z.string(),
    total_seconds: z.number(),
  }),
  calendars: z.array(TimePerCalendarBucketSchema),
  totals: z.object({
    timed_seconds: z.number(),
    timed_event_count: z.number().int(),
    allday_event_count: z.number().int(),
    pct_of_window: z.number(),
  }),
  excluded: z.array(z.string()),
});

// Derive the enum from the personas module so adding a built-in there
// automatically extends the input schema. The zod enum type signature
// requires a non-empty tuple, hence the explicit cast.
const PersonaName = z.enum([...BUILT_IN_PERSONA_NAMES, "custom"] as unknown as [
  string,
  ...string[],
]);

export const ListEventsInPersonaInputObject = z.object({
  persona: PersonaName,
  start_date: isoDate,
  end_date: isoDate,
  calendars: z.array(z.string().max(256)).max(20).optional(),
  custom_directive: z.string().max(4000).optional(),
});

export const ListEventsInPersonaInput = ListEventsInPersonaInputObject.refine(
  (v) => v.persona !== "custom" || (v.custom_directive ?? "").trim().length > 0,
  {
    message: "custom_directive is required and must be non-empty when persona is 'custom'",
    path: ["custom_directive"],
  },
);

export const ListEventsInPersonaOutput = z.object({
  persona_name: z.string(),
  persona_directive: z.string(),
  events: z.array(EventSchema),
  rewrite_instructions: z.string(),
});

// Memento mori overlay. Wraps list_events and attaches a per-event
// life_percent_consumed plus a cumulative running total. Caps mirror the
// persona tool so a hostile caller can't fan out unbounded per-calendar
// osascript queries.
export const MortalityOverlayInputObject = z.object({
  start_date: isoDate,
  end_date: isoDate,
  expected_lifespan_years: z.number().min(1).max(150).default(80),
  waking_hours_per_day: z.number().min(1).max(24).default(16),
  calendars: z.array(z.string().max(256)).max(20).optional(),
  birth_date: isoDate.optional(),
});

export const MortalityOverlayInput = MortalityOverlayInputObject.refine(
  (v) => Date.parse(v.end_date) > Date.parse(v.start_date),
  {
    message: "end_date must be strictly after start_date",
    path: ["end_date"],
  },
);

export const MortalityOverlayEventSchema = EventSchema.extend({
  duration_hours: z.number(),
  life_percent_consumed: z.number(),
  life_percent_consumed_cumulative: z.number(),
  pct_of_remaining_life: z.number().optional(),
});

export const MortalityOverlayOutput = z.object({
  baseline: z.object({
    expected_lifespan_years: z.number(),
    waking_hours_per_day: z.number(),
    total_waking_hours: z.number(),
    birth_date: z.string().optional(),
  }),
  events: z.array(MortalityOverlayEventSchema),
  totals: z.object({
    event_count: z.number().int(),
    total_hours: z.number(),
    total_life_percent: z.number(),
    total_pct_of_remaining_life: z.number().optional(),
  }),
});

// list_events_in_mixed_personas: assigns a DISTINCT voice from a 30+ pool to
// each event in the window. The voice/tone is the constant; cadence rotates.
export const MixedPersonasAssignmentStrategy = z.enum(["sequential", "shuffled", "thematic"]);

export const ListEventsInMixedPersonasInputObject = z.object({
  start_date: isoDate,
  end_date: isoDate,
  calendars: z.array(z.string().max(256)).max(20).optional(),
  voice_pool: z.array(z.string().max(128)).max(200).optional(),
  assignment_strategy: MixedPersonasAssignmentStrategy.default("thematic"),
  seed: z.number().int().default(42),
  include_mortality: z.boolean().default(false),
});

export const ListEventsInMixedPersonasInput = ListEventsInMixedPersonasInputObject.refine(
  (v) => Date.parse(v.end_date) > Date.parse(v.start_date),
  {
    message: "end_date must be strictly after start_date",
    path: ["end_date"],
  },
);

export const MixedPersonaEventSchema = EventSchema.extend({
  voice_name: z.string(),
  voice_directive: z.string(),
  life_percent_consumed: z.number().optional(),
});

export const ListEventsInMixedPersonasOutput = z.object({
  events: z.array(MixedPersonaEventSchema),
  voices_used: z.array(z.string()),
  voice_pool_size: z.number().int(),
  pool_exhausted_warning: z.boolean(),
  assignment_strategy: z.string(),
  rewrite_instructions: z.string(),
});

export type MixedPersonasAssignmentStrategyType = z.infer<typeof MixedPersonasAssignmentStrategy>;
export type ListEventsInMixedPersonasArgs = z.infer<typeof ListEventsInMixedPersonasInput>;
export type MixedPersonaEvent = z.infer<typeof MixedPersonaEventSchema>;
export type ListEventsInMixedPersonasResult = z.infer<typeof ListEventsInMixedPersonasOutput>;

export type ListEventsArgs = z.infer<typeof ListEventsInput>;
export type SearchEventsArgs = z.infer<typeof SearchEventsInput>;
export type CreateEventArgs = z.infer<typeof CreateEventInput>;
export type UpdateEventArgs = z.infer<typeof UpdateEventInput>;
export type DeleteEventArgs = z.infer<typeof DeleteEventInput>;
export type TimePerCalendarArgs = z.infer<typeof TimePerCalendarInput>;
export type TimePerCalendarBucket = z.infer<typeof TimePerCalendarBucketSchema>;
export type TimePerCalendarResult = z.infer<typeof TimePerCalendarOutput>;
export type ListEventsInPersonaArgs = z.infer<typeof ListEventsInPersonaInput>;
export type ListEventsInPersonaResult = z.infer<typeof ListEventsInPersonaOutput>;
export type MortalityOverlayArgs = z.infer<typeof MortalityOverlayInput>;
export type MortalityOverlayEvent = z.infer<typeof MortalityOverlayEventSchema>;
export type MortalityOverlayResult = z.infer<typeof MortalityOverlayOutput>;

// ----- Character-reminder + memory tooling -----

export const SeedCalendarMemoryInput = z.object({
  start_date: isoDate.optional(),
  end_date: isoDate.optional(),
  calendars: z.array(z.string().max(256)).max(64).optional(),
});

export const SeedCalendarMemoryOutput = z.object({
  total_events_seeded: z.number().int(),
  per_calendar: z.array(z.object({ calendar: z.string(), event_count: z.number().int() })),
  window: z.object({ start: z.string(), end: z.string() }),
  memory_path: z.string(),
  memory_file_size_bytes: z.number().int(),
});

export const QueryCalendarMemoryInputObject = z.object({
  query_type: z.enum([
    "by_person",
    "by_topic",
    "by_date_range",
    "by_calendar",
    "similar_to",
    "all",
  ]),
  query_string: z.string().max(256).optional(),
  start_date: isoDate.optional(),
  end_date: isoDate.optional(),
  calendar_name: z.string().max(256).optional(),
  event: z
    .object({
      title: z.string(),
      calendar: z.string().optional(),
      start: isoDate.optional(),
    })
    .optional(),
  limit: z.number().int().min(1).max(1000).default(50),
});

export const QueryCalendarMemoryInput = QueryCalendarMemoryInputObject.refine(
  (v) => {
    if (v.query_type === "by_person" || v.query_type === "by_topic") {
      return Boolean(v.query_string && v.query_string.trim().length > 0);
    }
    if (v.query_type === "by_date_range") {
      return Boolean(v.start_date && v.end_date);
    }
    if (v.query_type === "by_calendar") {
      return Boolean(v.calendar_name && v.calendar_name.trim().length > 0);
    }
    if (v.query_type === "similar_to") {
      return Boolean(v.event && v.event.title.trim().length > 0);
    }
    return true;
  },
  { message: "Required parameters missing for the chosen query_type" },
);

const MemoryEventSchema = z.object({
  uid: z.string(),
  title: z.string(),
  start: z.string(),
  end: z.string(),
  duration_hours: z.number(),
  calendar: z.string(),
  notes: z.string().optional(),
  attended: z.boolean().optional(),
  observations: z.array(z.string()).optional(),
});

// v2 memory schema records — surfaced through enrichment so Claude can
// reference real people / topics / facts / user notes when composing voice.
const PersonRecordSchema = z.object({
  name: z.string(),
  role: z.string().optional(),
  relationship: z.string().optional(),
  email: z.string().optional(),
  first_seen: z.string(),
  last_seen: z.string(),
  appearances: z.array(z.string()),
  external_summary: z.string().optional(),
  notes: z.string().optional(),
});

const TopicRecordSchema = z.object({
  name: z.string(),
  kind: z.enum(["course", "event_type", "location", "domain", "club", "other"]).optional(),
  first_seen: z.string(),
  last_seen: z.string(),
  appearance_count: z.number().int(),
  external_summary: z.string().optional(),
  notes: z.string().optional(),
  related_people: z.array(z.string()).optional(),
});

const ExternalFactSchema = z.object({
  entity: z.string(),
  kind: z.enum(["person", "topic", "location", "domain"]),
  summary: z.string(),
  sources: z.array(z.string()),
  confidence: z.number(),
  cached_at: z.string(),
  ttl_days: z.number(),
});

const UserNoteSchema = z.object({
  text: z.string(),
  source_input: z.string().optional(),
  ts: z.string(),
});

export const QueryCalendarMemoryOutput = z.object({
  matches: z.array(MemoryEventSchema),
  total_in_memory: z.number().int(),
  query_summary: z.string(),
});

// Inline character definitions accepted via the tool call. Same shape as the
// built-in `Character` interface in characters.ts, validated independently
// here so we don't import zod into characters.ts (which would create a cycle).
const InlineCharacterSchema = z.object({
  name: z.string().min(1).max(64),
  short_label: z.string().min(1).max(16),
  directive: z.string().min(1).max(300),
  triggers: z.array(z.string().max(64)).max(32).optional(),
  default: z.boolean().optional(),
});

// Inline distiller definitions accepted via the tool call. Mirrors the
// `Distiller` interface in distillers.ts. Directive is allowed up to 400
// chars (vs. 300 for character) because a distiller's voice fingerprint
// usually needs more pet-phrases + worldview detail.
const InlineDistillerSchema = z.object({
  name: z.string().min(1).max(64),
  short_label: z.string().min(1).max(16),
  directive: z.string().min(1).max(400),
  attribution: z.string().min(1).max(300),
  signature_phrases: z.array(z.string().max(128)).max(12),
  worldview_tags: z.array(z.string().max(64)).max(16),
  representative_url: z.string().max(512).optional(),
  triggers: z.array(z.string().max(64)).max(32).optional(),
  default: z.boolean().optional(),
});

export const EnrichWithCharacterRemindersInputObject = z.object({
  start_date: isoDate,
  end_date: isoDate,
  calendars: z.array(z.string().max(256)).max(20).optional(),
  character_pool: z.array(z.string().max(64)).max(64).optional(),
  include_memory_context: z.boolean().default(true),
  memory_context_size: z.number().int().min(0).max(20).default(3),
  seed: z.number().int().default(42),
  // User-defined characters merged in alongside the built-ins. Inline entries
  // override (by `name`) anything from the persistent config or the built-in
  // pool. Cap at 30 to keep the merged pool a sensible size.
  custom_characters: z.array(InlineCharacterSchema).max(30).optional(),
  // When false, skip reading ~/.apple-calendar-mcp/characters.json. Lets the
  // caller get a fully reproducible run regardless of host machine state.
  use_persistent_config: z.boolean().default(true),
  // Distillers — synthetic voices distilled from public material of specific
  // named people (Garry Tan, PG, Naval, etc.). Merge alongside characters
  // into one assignment pool; conflict resolution by name (inline > persistent
  // > built-in).
  distiller_pool: z.array(z.string().max(64)).max(64).optional(),
  custom_distillers: z.array(InlineDistillerSchema).max(30).optional(),
});

export const EnrichWithCharacterRemindersInput = EnrichWithCharacterRemindersInputObject.refine(
  (v) => Date.parse(v.end_date) > Date.parse(v.start_date),
  {
    message: "end_date must be strictly after start_date",
    path: ["end_date"],
  },
);

export const EnrichedCharacterEventSchema = EventSchema.extend({
  character_label: z.string(),
  character_directive: z.string(),
  memory_context: z.array(MemoryEventSchema),
  // v2: full context bundle. Each is a sibling to `memory_context` so
  // existing v1 callers that only read memory_context keep working.
  people_context: z.array(PersonRecordSchema),
  topic_context: z.array(TopicRecordSchema),
  external_facts: z.array(ExternalFactSchema),
  user_notes_relevant: z.array(UserNoteSchema),
  rewrite_instruction: z.string(),
  // Populated only when the assigned voice is a Distiller (vs. a Character).
  // `attribution` is the synthetic-voice disclaimer; `signature_phrases` are
  // the verbatim phrases the distiller tends to use, for richer rewrite
  // context. Both omitted on plain Characters.
  distiller_attribution: z.string().optional(),
  distiller_signature_phrases: z.array(z.string()).optional(),
});

export const EnrichWithCharacterRemindersOutput = z.object({
  events: z.array(EnrichedCharacterEventSchema),
  characters_used: z.array(z.string()),
  rewrite_template: z.string(),
});

export const ApplyCharacterRemindersInput = z.object({
  events_with_reminders: z
    .array(
      z.object({
        uid: z.string().min(1),
        calendar: z.string().min(1),
        new_title: z.string().min(1).max(500),
        new_notes: z.string().max(8000).optional(),
      }),
    )
    .min(1)
    .max(200),
  dry_run: z.boolean().default(false),
});

export const ApplyCharacterRemindersOutput = z.object({
  applied: z.array(
    z.object({
      uid: z.string(),
      calendar: z.string(),
      ok: z.boolean(),
      new_title: z.string().optional(),
      backup_pointer: z.string().optional(),
      error: z.string().optional(),
    }),
  ),
  backup_path: z.string().optional(),
  dry_run: z.boolean(),
});

export const RevertCharacterRemindersInput = z.object({
  start_date: isoDate.optional(),
  end_date: isoDate.optional(),
  calendars: z.array(z.string().max(256)).max(20).optional(),
});

export const RevertCharacterRemindersOutput = z.object({
  reverted: z.array(
    z.object({
      uid: z.string(),
      calendar: z.string(),
      ok: z.boolean(),
      restored_title: z.string().optional(),
      error: z.string().optional(),
    }),
  ),
  total_with_backup: z.number().int(),
});

export type SeedCalendarMemoryArgs = z.infer<typeof SeedCalendarMemoryInput>;
export type SeedCalendarMemoryResult = z.infer<typeof SeedCalendarMemoryOutput>;
export type QueryCalendarMemoryArgs = z.infer<typeof QueryCalendarMemoryInput>;
export type QueryCalendarMemoryResult = z.infer<typeof QueryCalendarMemoryOutput>;
export type EnrichWithCharacterRemindersArgs = z.infer<typeof EnrichWithCharacterRemindersInput>;
export type EnrichedCharacterEvent = z.infer<typeof EnrichedCharacterEventSchema>;
export type EnrichWithCharacterRemindersResult = z.infer<typeof EnrichWithCharacterRemindersOutput>;
export type ApplyCharacterRemindersArgs = z.infer<typeof ApplyCharacterRemindersInput>;
export type ApplyCharacterRemindersResult = z.infer<typeof ApplyCharacterRemindersOutput>;
export type RevertCharacterRemindersArgs = z.infer<typeof RevertCharacterRemindersInput>;
export type RevertCharacterRemindersResult = z.infer<typeof RevertCharacterRemindersOutput>;

// ----- Distillers -----

export const ListDistillersInput = z.object({
  worldview_filter: z.string().max(64).optional(),
  name_filter: z.string().max(128).optional(),
  use_persistent_config: z.boolean().default(true),
});

const DistillerOutputSchema = z.object({
  name: z.string(),
  short_label: z.string(),
  // Synthetic-voice disclaimer. Each distiller carries this so callers see
  // the "not endorsed by the named individual" statement at every layer.
  attribution: z.string(),
  signature_phrases: z.array(z.string()),
  worldview_tags: z.array(z.string()),
  representative_url: z.string().optional(),
  triggers: z.array(z.string()).optional(),
  default: z.boolean().optional(),
});

export const ListDistillersOutput = z.object({
  distillers: z.array(DistillerOutputSchema),
  total: z.number().int(),
  source: z.enum(["built-in", "persistent", "merged"]),
  // Repeated at the envelope level so a thin client that only logs the
  // top-level summary still sees the synthetic-voice disclaimer.
  notice: z.string(),
});

export type ListDistillersArgs = z.infer<typeof ListDistillersInput>;
export type ListDistillersResult = z.infer<typeof ListDistillersOutput>;

export const DistillVoiceFromTextInput = z.object({
  name: z.string().min(1).max(64),
  short_label: z.string().min(1).max(16),
  corpus_text: z.string().min(20).max(50_000),
  worldview_tags: z.array(z.string().max(64)).max(16).default([]),
  triggers: z.array(z.string().max(64)).max(32).default([]),
  representative_url: z.string().max(512).optional(),
});

export const DistillVoiceFromTextOutput = z.object({
  draft_distiller: z.object({
    name: z.string(),
    short_label: z.string(),
    attribution: z.string(),
    worldview_tags: z.array(z.string()),
    triggers: z.array(z.string()),
    directive: z.string(),
    signature_phrases: z.array(z.string()),
    representative_url: z.string().optional(),
  }),
  corpus_text: z.string(),
  generation_instructions: z.string(),
});

export type DistillVoiceFromTextArgs = z.infer<typeof DistillVoiceFromTextInput>;
export type DistillVoiceFromTextResult = z.infer<typeof DistillVoiceFromTextOutput>;
