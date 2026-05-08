import { z } from "zod";
import {
  DEFAULT_MEMORY_PATH,
  getRelevantContextForEvent,
  loadMemory,
  type ExternalFact,
  type MemoryEvent,
  type PersonRecord,
  type TopicRecord,
  type UserNote,
} from "../memory.js";

// Stage 6: assemble the full context bundle Claude needs to compose voice
// commentary for ONE event. Caller can pass either an existing event UID
// (resolved from memory) or an inline event spec for events not yet stored.

const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), {
  message: "Must be a valid ISO 8601 date string",
});

// Object schema (unrefined) — exposed so MCP tool registration can read
// `.shape` for its input metadata. Refined version below adds the
// require-one-of rule.
export const QueryFullContextForEventInputObject = z.object({
  event_uid: z.string().min(1).max(512).optional(),
  event_inline: z
    .object({
      title: z.string().min(1).max(500),
      start: isoDate.optional(),
      end: isoDate.optional(),
      calendar: z.string().max(256).optional(),
      notes: z.string().max(8000).optional(),
    })
    .optional(),
  top_n_memory: z.number().int().min(0).max(50).default(3),
  top_n_people: z.number().int().min(0).max(50).default(5),
  top_n_topics: z.number().int().min(0).max(50).default(3),
  top_n_user_notes: z.number().int().min(0).max(50).default(5),
  include_user_notes: z.boolean().default(true),
});

export const QueryFullContextForEventInput = QueryFullContextForEventInputObject.refine(
  (v) => Boolean(v.event_uid) || Boolean(v.event_inline),
  {
    message: "Must provide either event_uid or event_inline",
    path: ["event_uid"],
  },
);

type QueryFullContextForEventArgs = z.infer<typeof QueryFullContextForEventInput>;

interface QueryFullContextForEventResult {
  event: {
    uid?: string;
    title: string;
    start?: string;
    end?: string;
    calendar?: string;
    notes?: string;
  };
  memory_context_items: MemoryEvent[];
  people_context: PersonRecord[];
  topic_context: TopicRecord[];
  external_facts: ExternalFact[];
  user_notes_relevant: UserNote[];
}

export async function queryFullContextForEvent(
  args: QueryFullContextForEventArgs,
  memoryPath: string = DEFAULT_MEMORY_PATH,
): Promise<QueryFullContextForEventResult> {
  const memory = loadMemory(memoryPath);

  let event: QueryFullContextForEventResult["event"];
  if (args.event_uid) {
    const found = memory.events.find((e) => e.uid === args.event_uid);
    if (!found) {
      // Fall back to inline if both supplied; otherwise build a minimal stub
      // so we still return SOMETHING usable rather than throwing.
      if (args.event_inline) {
        event = { ...args.event_inline };
      } else {
        return {
          event: { uid: args.event_uid, title: "" },
          memory_context_items: [],
          people_context: [],
          topic_context: [],
          external_facts: [],
          user_notes_relevant: [],
        };
      }
    } else {
      event = {
        uid: found.uid,
        title: found.title,
        start: found.start,
        end: found.end,
        calendar: found.calendar,
        ...(found.notes !== undefined ? { notes: found.notes } : {}),
      };
    }
  } else if (args.event_inline) {
    event = { ...args.event_inline };
  } else {
    // Refine guard prevents this branch, but TS narrowing requires it.
    throw new Error("event_uid or event_inline required");
  }

  const ctx = getRelevantContextForEvent(
    memory,
    {
      title: event.title,
      ...(event.start !== undefined ? { start: event.start } : {}),
      ...(event.calendar !== undefined ? { calendar: event.calendar } : {}),
      ...(event.notes !== undefined ? { notes: event.notes } : {}),
    },
    {
      top_n_memory: args.top_n_memory,
      top_n_people: args.top_n_people,
      top_n_topics: args.top_n_topics,
      top_n_user_notes: args.top_n_user_notes,
      include_user_notes: args.include_user_notes,
    },
  );

  return {
    event,
    ...ctx,
  };
}
