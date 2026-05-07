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
