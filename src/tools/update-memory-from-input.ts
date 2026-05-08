import { z } from "zod";
import {
  DEFAULT_MEMORY_PATH,
  loadMemory,
  mergeEvents,
  mergePeople,
  mergeTopics,
  mergeUserNotes,
  saveMemory,
  type MemoryEvent,
  type PersonRecord,
  type TopicRecord,
  type UserNote,
} from "../memory.js";

// Stage 3: bulk-merge extraction + research output into memory. Each input
// array is independently merged; missing arrays leave that slice of memory
// untouched. Caps mirror other tools to bound a hostile/buggy caller.

const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), {
  message: "Must be a valid ISO 8601 date string",
});

const MemoryEventInput = z.object({
  uid: z.string().min(1).max(512),
  title: z.string().min(1).max(500),
  start: isoDate,
  end: isoDate,
  duration_hours: z.number().min(0),
  calendar: z.string().min(1).max(256),
  notes: z.string().max(8000).optional(),
  attended: z.boolean().optional(),
  observations: z.array(z.string().max(1000)).max(30).optional(),
});

const PersonRecordInput = z.object({
  name: z.string().min(1).max(256),
  role: z.string().max(256).optional(),
  relationship: z.string().max(128).optional(),
  email: z.string().max(256).optional(),
  first_seen: isoDate,
  last_seen: isoDate.optional(),
  appearances: z.array(z.string().max(512)).max(200).default([]),
  external_summary: z.string().max(800).optional(),
  notes: z.string().max(2000).optional(),
});

const TopicRecordInput = z.object({
  name: z.string().min(1).max(256),
  kind: z.enum(["course", "event_type", "location", "domain", "club", "other"]).optional(),
  first_seen: isoDate,
  last_seen: isoDate.optional(),
  appearance_count: z.number().int().min(0).default(1),
  external_summary: z.string().max(800).optional(),
  notes: z.string().max(2000).optional(),
  related_people: z.array(z.string().max(256)).max(50).optional(),
});

export const UpdateMemoryFromInputInput = z.object({
  events: z.array(MemoryEventInput).max(30).optional(),
  people: z.array(PersonRecordInput).max(30).optional(),
  topics: z.array(TopicRecordInput).max(30).optional(),
  user_statements: z.array(z.string().min(1).max(4000)).max(30).optional(),
  source_label: z.string().min(1).max(256),
});

type UpdateMemoryFromInputArgs = z.infer<typeof UpdateMemoryFromInputInput>;

interface UpdateMemoryFromInputResult {
  memory_size: {
    events: number;
    people: number;
    topics: number;
    user_notes: number;
    external_facts: number;
  };
  new_entities: {
    people: string[];
    topics: string[];
  };
}

export async function updateMemoryFromInput(
  args: UpdateMemoryFromInputArgs,
  memoryPath: string = DEFAULT_MEMORY_PATH,
): Promise<UpdateMemoryFromInputResult> {
  let memory = loadMemory(memoryPath);

  const knownPeopleBefore = new Set(Object.keys(memory.people ?? {}));
  const knownTopicsBefore = new Set(Object.keys(memory.topics ?? {}));

  if (args.events && args.events.length > 0) {
    memory = mergeEvents(memory, args.events as MemoryEvent[]);
  }
  if (args.people && args.people.length > 0) {
    const now = new Date().toISOString();
    const records: PersonRecord[] = args.people.map((p) => ({
      name: p.name,
      ...(p.role !== undefined ? { role: p.role } : {}),
      ...(p.relationship !== undefined ? { relationship: p.relationship } : {}),
      ...(p.email !== undefined ? { email: p.email } : {}),
      first_seen: p.first_seen,
      last_seen: p.last_seen ?? p.first_seen ?? now,
      appearances: p.appearances ?? [],
      ...(p.external_summary !== undefined ? { external_summary: p.external_summary } : {}),
      ...(p.notes !== undefined ? { notes: p.notes } : {}),
    }));
    memory = mergePeople(memory, records);
  }
  if (args.topics && args.topics.length > 0) {
    const now = new Date().toISOString();
    const records: TopicRecord[] = args.topics.map((t) => ({
      name: t.name,
      ...(t.kind !== undefined ? { kind: t.kind } : {}),
      first_seen: t.first_seen,
      last_seen: t.last_seen ?? t.first_seen ?? now,
      appearance_count: t.appearance_count,
      ...(t.external_summary !== undefined ? { external_summary: t.external_summary } : {}),
      ...(t.notes !== undefined ? { notes: t.notes } : {}),
      ...(t.related_people !== undefined ? { related_people: t.related_people } : {}),
    }));
    memory = mergeTopics(memory, records);
  }
  if (args.user_statements && args.user_statements.length > 0) {
    const ts = new Date().toISOString();
    const notes: UserNote[] = args.user_statements.map((s) => ({
      text: s,
      source_input: args.source_label,
      ts,
    }));
    memory = mergeUserNotes(memory, notes);
  }

  saveMemory(memory, memoryPath);

  const peopleNow = memory.people ?? {};
  const topicsNow = memory.topics ?? {};
  const newPeople = Object.keys(peopleNow).filter((k) => !knownPeopleBefore.has(k));
  const newTopics = Object.keys(topicsNow).filter((k) => !knownTopicsBefore.has(k));

  return {
    memory_size: {
      events: memory.events.length,
      people: Object.keys(peopleNow).length,
      topics: Object.keys(topicsNow).length,
      user_notes: (memory.user_notes ?? []).length,
      external_facts: Object.keys(memory.external_facts ?? {}).length,
    },
    new_entities: {
      people: newPeople,
      topics: newTopics,
    },
  };
}
