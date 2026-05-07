import { BUILT_IN_CHARACTERS, type Character } from "../characters.js";
import {
  DEFAULT_MEMORY_PATH,
  loadMemory,
  recentSimilarEvents,
  type MemoryEvent,
  type MemoryFile,
} from "../memory.js";
import type {
  CalendarEvent,
  EnrichWithCharacterRemindersArgs,
  EnrichWithCharacterRemindersResult,
  EnrichedCharacterEvent,
} from "../types.js";
import { mapWithConcurrency } from "../util/concurrency.js";
import { seededShuffle } from "./list-events-in-mixed-personas.js";
import { listEvents } from "./list-events.js";

const ENRICH_FAN_OUT_CONCURRENCY = 4;

export const REWRITE_TEMPLATE =
  'For each event:\n1. Read the character_directive and the memory_context_items.\n2. Compose ONE sentence in the character\'s voice that references at least one memory_context_item by event title or by a recognizable detail.\n3. Output the new title in this exact format: "{original_title} — {character_label}: {your_sentence}"\n4. Keep total title length ≤ 100 chars; truncate the sentence first if needed.';

const PER_EVENT_REWRITE_INSTRUCTION =
  "Compose ONE sentence in this character's voice that references at least one memory_context item; output as `{original_title} — {character_label}: {sentence}` and keep total ≤100 chars.";

function resolveCharacterPool(names: readonly string[] | undefined): Character[] {
  if (!names || names.length === 0) {
    return BUILT_IN_CHARACTERS.slice();
  }
  const byName = new Map(BUILT_IN_CHARACTERS.map((c) => [c.name, c]));
  const out: Character[] = [];
  const unknown: string[] = [];
  for (const n of names) {
    const c = byName.get(n);
    if (!c) {
      unknown.push(n);
    } else {
      out.push(c);
    }
  }
  if (unknown.length > 0) {
    throw new Error(`Unknown character name(s): ${unknown.join(", ")}`);
  }
  return out;
}

function scoreCharacterAgainstEvent(character: Character, event: CalendarEvent): number {
  if (!character.triggers || character.triggers.length === 0) {
    return 0;
  }
  const haystack = `${event.title} ${event.notes ?? ""} ${event.location ?? ""}`.toLowerCase();
  let score = 0;
  for (const trigger of character.triggers) {
    if (haystack.includes(trigger.toLowerCase())) {
      score += 1;
    }
  }
  return score;
}

// Greedy thematic assignment with deterministic tiebreak. Mirrors the
// list_events_in_mixed_personas thematic strategy but does NOT enforce
// distinctness — characters are relational, not literary, so reuse across
// many events is fine ("Mom" can leave several reminders in one week).
export function assignCharacters(
  events: readonly CalendarEvent[],
  pool: readonly Character[],
  seed: number,
): Map<string, Character> {
  const out = new Map<string, Character>();
  if (events.length === 0 || pool.length === 0) {
    return out;
  }
  const shuffled = seededShuffle(pool, seed);
  let cycleIdx = 0;
  for (const evt of events) {
    let best: Character | undefined;
    let bestScore = 0;
    for (const c of shuffled) {
      const s = scoreCharacterAgainstEvent(c, evt);
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    if (!best) {
      // No trigger overlap: cycle through the shuffled pool for deterministic
      // distribution rather than always falling back to the first character.
      best = shuffled[cycleIdx % shuffled.length] as Character;
      cycleIdx += 1;
    }
    out.set(evt.id, best);
  }
  return out;
}

interface BuildEnrichmentInput {
  args: EnrichWithCharacterRemindersArgs;
  events: CalendarEvent[];
  memory: MemoryFile;
}

export function buildEnrichmentResult(
  input: BuildEnrichmentInput,
): EnrichWithCharacterRemindersResult {
  const { args, events, memory } = input;
  const pool = resolveCharacterPool(args.character_pool);
  const sorted = events.toSorted((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const assignment = assignCharacters(sorted, pool, args.seed);
  const usedNames = new Set<string>();

  const outEvents: EnrichedCharacterEvent[] = sorted.map((evt) => {
    const character = assignment.get(evt.id);
    if (!character) {
      throw new Error(`Character assignment missing for event id=${evt.id}`);
    }
    usedNames.add(character.name);

    let memoryContext: MemoryEvent[] = [];
    if (args.include_memory_context && args.memory_context_size > 0) {
      memoryContext = recentSimilarEvents(
        memory,
        { title: evt.title, calendar: evt.calendar_name, start: evt.start },
        args.memory_context_size,
      );
    }

    const out: EnrichedCharacterEvent = {
      id: evt.id,
      title: evt.title,
      start: evt.start,
      end: evt.end,
      all_day: evt.all_day,
      calendar_name: evt.calendar_name,
      character_label: character.short_label,
      character_directive: character.directive,
      memory_context: memoryContext,
      rewrite_instruction: PER_EVENT_REWRITE_INSTRUCTION,
    };
    if (evt.location !== undefined) {
      out.location = evt.location;
    }
    if (evt.notes !== undefined) {
      out.notes = evt.notes;
    }
    if (evt.url !== undefined) {
      out.url = evt.url;
    }
    return out;
  });

  return {
    events: outEvents,
    characters_used: Array.from(usedNames),
    rewrite_template: REWRITE_TEMPLATE,
  };
}

async function collectEvents(args: EnrichWithCharacterRemindersArgs): Promise<CalendarEvent[]> {
  const baseArgs = {
    start_date: args.start_date,
    end_date: args.end_date,
    limit: 500,
  };
  if (!args.calendars || args.calendars.length === 0) {
    return listEvents(baseArgs);
  }
  const results = await mapWithConcurrency(args.calendars, ENRICH_FAN_OUT_CONCURRENCY, (name) =>
    listEvents({ ...baseArgs, calendar_name: name }),
  );
  return results.flat();
}

export async function enrichWithCharacterReminders(
  args: EnrichWithCharacterRemindersArgs,
  memoryPath: string = DEFAULT_MEMORY_PATH,
): Promise<EnrichWithCharacterRemindersResult> {
  const events = await collectEvents(args);
  const memory = loadMemory(memoryPath);
  return buildEnrichmentResult({ args, events, memory });
}
