import {
  BUILT_IN_CHARACTERS,
  DEFAULT_CHARACTERS_CONFIG_PATH,
  loadCustomCharacters,
  mergeCharacterPools,
  type Character,
} from "../characters.js";
import {
  BUILT_IN_DISTILLERS,
  DEFAULT_DISTILLERS_CONFIG_PATH,
  loadCustomDistillers,
  mergeDistillerPools,
  type Distiller,
} from "../distillers.js";
import {
  DEFAULT_MEMORY_PATH,
  getRelevantContextForEvent,
  loadMemory,
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

export const REWRITE_INSTRUCTIONS =
  "For each event:\n" +
  "1. Read the character_directive and the memory_context_items array.\n" +
  "2. If memory_context_items is NON-EMPTY: reference at least one item BY ITS LITERAL TITLE OR DATE in your sentence. do NOT invent counts or dates that are not in memory_context_items. If you say 'the 5th time' or 'since spring', memory_context_items MUST contain at least 4 prior matching events to back that claim.\n" +
  "3. If memory_context_items is EMPTY: your sentence MUST acknowledge that the event has no prior instances on the calendar. Allowed honest phrasings: 'first time on calendar', 'no precedent', 'the first instance becomes the seed', '初见于此'. do NOT invent a 'Nth' count, a date, or a prior-event title.\n" +
  '4. Output the new title in the format: "{original_title} — {character_label}: {your_sentence}".\n' +
  "5. Keep total title length ≤ 100 chars.\n" +
  "6. NEVER fabricate. The voice is the wrapper; the memory references must be true. Without truth, the joke has no punch.";

export const REWRITE_INSTRUCTIONS_V2 =
  "For each event:\n" +
  "1. Read character_directive + memory_context_items + people_context + topic_context + external_facts + user_notes_relevant.\n" +
  "2. Reference at least one CONCRETE item across these categories by literal title/date/name. Do NOT invent counts/dates/names not present in the supplied context.\n" +
  "3. If ALL context categories are empty: say 'first time on calendar' / 'no precedent' / '初见于此' honestly.\n" +
  "4. Use external_facts to give actual domain advice in voice (e.g. if voice is Karpathy and fact says event is a CG course, the advice should reference scaling laws / forward pass / etc. — voice + domain).\n" +
  '5. Output: "{original_title} — {character_label}: {your_sentence}"\n' +
  "6. Total ≤ 100 chars.\n" +
  "7. NEVER fabricate. The voice is the wrapper; every claim must trace to context.";

const PER_EVENT_REWRITE_INSTRUCTION =
  "Compose ONE sentence in this character's voice. Reference at least one literal item from memory_context / people_context / topic_context / external_facts / user_notes_relevant. If ALL are empty, say 'first time on calendar' (or '初见于此') honestly. Output as `{original_title} — {character_label}: {sentence}`, ≤100 chars total. Never fabricate.";

/**
 * Resolve the final character pool used for assignment.
 *
 * 1. Start from built-ins.
 * 2. Layer in persistent config from disk (unless `use_persistent_config` is
 *    false).
 * 3. Layer in inline `custom_characters` from the tool call.
 * 4. If the caller supplied an explicit `character_pool` (list of names),
 *    filter the merged set to those names — error on any unknown name.
 *
 * Conflict resolution by `name`: inline > persistent > built-in.
 */
function resolveCharacterPool(
  characterNames: readonly string[] | undefined,
  distillerNames: readonly string[] | undefined,
  inlineCharacters: readonly Character[],
  persistentCharacters: readonly Character[],
  inlineDistillers: readonly Distiller[],
  persistentDistillers: readonly Distiller[],
): Character[] {
  const mergedCharacters = mergeCharacterPools(
    BUILT_IN_CHARACTERS,
    persistentCharacters,
    inlineCharacters,
  );
  const mergedDistillers = mergeDistillerPools(
    BUILT_IN_DISTILLERS,
    persistentDistillers,
    inlineDistillers,
  );

  // Distillers extend Character — they're assignable to the Character pool
  // unchanged. Distiller fields (attribution, signature_phrases) survive on
  // the object and are read by buildEnrichmentResult below.
  const haveExplicitFilter =
    (characterNames && characterNames.length > 0) || (distillerNames && distillerNames.length > 0);

  if (!haveExplicitFilter) {
    // Default: characters + distillers merged into one pool, conflicts by name.
    const byName = new Map<string, Character>();
    for (const c of mergedCharacters) {
      byName.set(c.name, c);
    }
    for (const d of mergedDistillers) {
      byName.set(d.name, d);
    }
    return Array.from(byName.values());
  }

  const out: Character[] = [];
  const unknownChars: string[] = [];
  const unknownDistillers: string[] = [];
  if (characterNames && characterNames.length > 0) {
    const byName = new Map(mergedCharacters.map((c) => [c.name, c]));
    for (const n of characterNames) {
      const c = byName.get(n);
      if (!c) {
        unknownChars.push(n);
      } else {
        out.push(c);
      }
    }
  }
  if (distillerNames && distillerNames.length > 0) {
    const byName = new Map(mergedDistillers.map((d) => [d.name, d]));
    for (const n of distillerNames) {
      const d = byName.get(n);
      if (!d) {
        unknownDistillers.push(n);
      } else {
        out.push(d);
      }
    }
  }
  if (unknownChars.length > 0) {
    throw new Error(`Unknown character name(s): ${unknownChars.join(", ")}`);
  }
  if (unknownDistillers.length > 0) {
    throw new Error(`Unknown distiller name(s): ${unknownDistillers.join(", ")}`);
  }
  return out;
}

function isDistiller(value: Character): value is Distiller {
  const v = value as Partial<Distiller>;
  return (
    typeof v.attribution === "string" &&
    Array.isArray(v.signature_phrases) &&
    Array.isArray(v.worldview_tags)
  );
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
  /** Persisted user-defined characters loaded from the config file. */
  persistentCharacters?: readonly Character[];
  /** Persisted user-defined distillers loaded from the config file. */
  persistentDistillers?: readonly Distiller[];
}

export function buildEnrichmentResult(
  input: BuildEnrichmentInput,
): EnrichWithCharacterRemindersResult {
  const { args, events, memory, persistentCharacters = [], persistentDistillers = [] } = input;
  const inlineCharacters = (args.custom_characters ?? []) as readonly Character[];
  const inlineDistillers = (args.custom_distillers ?? []) as readonly Distiller[];
  const pool = resolveCharacterPool(
    args.character_pool,
    args.distiller_pool,
    inlineCharacters,
    persistentCharacters,
    inlineDistillers,
    persistentDistillers,
  );
  const sorted = events.toSorted((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const assignment = assignCharacters(sorted, pool, args.seed);
  const usedNames = new Set<string>();

  const outEvents: EnrichedCharacterEvent[] = sorted.map((evt) => {
    const character = assignment.get(evt.id);
    if (!character) {
      throw new Error(`Character assignment missing for event id=${evt.id}`);
    }
    usedNames.add(character.name);

    const wantContext = args.include_memory_context && args.memory_context_size > 0;
    const ctx = wantContext
      ? getRelevantContextForEvent(
          memory,
          {
            title: evt.title,
            calendar: evt.calendar_name,
            start: evt.start,
            ...(evt.notes !== undefined ? { notes: evt.notes } : {}),
          },
          {
            top_n_memory: args.memory_context_size,
            top_n_people: 5,
            top_n_topics: 3,
            top_n_user_notes: 5,
            include_user_notes: true,
          },
        )
      : {
          memory_context_items: [],
          people_context: [],
          topic_context: [],
          external_facts: [],
          user_notes_relevant: [],
        };

    const out: EnrichedCharacterEvent = {
      id: evt.id,
      title: evt.title,
      start: evt.start,
      end: evt.end,
      all_day: evt.all_day,
      calendar_name: evt.calendar_name,
      character_label: character.short_label,
      character_directive: character.directive,
      memory_context: ctx.memory_context_items,
      people_context: ctx.people_context,
      topic_context: ctx.topic_context,
      external_facts: ctx.external_facts,
      user_notes_relevant: ctx.user_notes_relevant,
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
    if (isDistiller(character)) {
      out.distiller_attribution = character.attribution;
      out.distiller_signature_phrases = character.signature_phrases;
    }
    return out;
  });

  return {
    events: outEvents,
    characters_used: Array.from(usedNames),
    rewrite_template: REWRITE_INSTRUCTIONS_V2,
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
  charactersConfigPath: string = DEFAULT_CHARACTERS_CONFIG_PATH,
  distillersConfigPath: string = DEFAULT_DISTILLERS_CONFIG_PATH,
): Promise<EnrichWithCharacterRemindersResult> {
  const events = await collectEvents(args);
  const memory = loadMemory(memoryPath);
  const persistentCharacters = args.use_persistent_config
    ? loadCustomCharacters(charactersConfigPath)
    : [];
  const persistentDistillers = args.use_persistent_config
    ? loadCustomDistillers(distillersConfigPath)
    : [];
  return buildEnrichmentResult({
    args,
    events,
    memory,
    persistentCharacters,
    persistentDistillers,
  });
}
