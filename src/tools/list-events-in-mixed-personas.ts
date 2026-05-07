import type {
  CalendarEvent,
  ListEventsInMixedPersonasArgs,
  ListEventsInMixedPersonasResult,
  MixedPersonaEvent,
  MixedPersonasAssignmentStrategyType,
} from "../types.js";
import { mapWithConcurrency } from "../util/concurrency.js";
import { BUILT_IN_VOICES, type Voice } from "../voices.js";
import { listEvents } from "./list-events.js";
import { buildBaseline, computeMortalityFields } from "./mortality-overlay.js";

export const REWRITE_INSTRUCTIONS =
  "For each event in this list, rewrite the user-facing title and notes in the voice indicated by `voice_name`, following the `voice_directive` for that voice. Each event has a different voice — never use the same voice for two events in your rendering. Keep the original event time range and calendar name visible. The original event title should NOT appear in your rewritten output — voice is the joke; the original is metadata. When `life_percent_consumed` is present, prefix the rewritten title with `⌛X.XXXX% · ` (4 sig figs).";

// Cap parallel osascript fan-out. Same rationale as the persona/mortality
// tools — four workers overlap I/O wait without producing a noticeable load
// spike on the user's Mac.
const MIXED_PERSONAS_FAN_OUT_CONCURRENCY = 4;

// Mortality defaults exposed here mirror MortalityOverlayInput's defaults,
// kept in sync intentionally. We don't expose lifespan params in the input
// schema — that's mortality_overlay's job; this is a "for free" hint.
const DEFAULT_LIFESPAN_YEARS = 80;
const DEFAULT_WAKING_HOURS = 16;

// Mulberry32 PRNG. Tiny, deterministic, good-enough distribution for
// shuffling — we are not generating cryptographic material here.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(arr: readonly T[], seed: number): T[] {
  const out = arr.slice();
  const rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}

function scoreVoiceAgainstEvent(voice: Voice, event: CalendarEvent): number {
  if (!voice.tags || voice.tags.length === 0) {
    return 0;
  }
  const haystack = `${event.title} ${event.notes ?? ""} ${event.location ?? ""}`.toLowerCase();
  let score = 0;
  for (const tag of voice.tags) {
    if (haystack.includes(tag.toLowerCase())) {
      score += 1;
    }
  }
  return score;
}

// Pure helper — testable without spawning osascript. Returns a map keyed by
// event.id. When event_count > pool.length and strategy !== "sequential",
// the trailing events get cycled through the (shuffled) pool — distinctness
// is impossible by pigeonhole; the wrapper sets pool_exhausted_warning.
export function assignVoices(
  events: readonly CalendarEvent[],
  pool: readonly Voice[],
  strategy: MixedPersonasAssignmentStrategyType,
  seed: number,
): Map<string, Voice> {
  const out = new Map<string, Voice>();
  if (pool.length === 0 || events.length === 0) {
    return out;
  }

  if (strategy === "sequential") {
    for (let i = 0; i < events.length; i++) {
      const evt = events[i] as CalendarEvent;
      const voice = pool[i % pool.length] as Voice;
      out.set(evt.id, voice);
    }
    return out;
  }

  const shuffled = seededShuffle(pool, seed);

  if (strategy === "shuffled") {
    for (let i = 0; i < events.length; i++) {
      const evt = events[i] as CalendarEvent;
      const voice = shuffled[i % shuffled.length] as Voice;
      out.set(evt.id, voice);
    }
    return out;
  }

  // strategy === "thematic"
  // Greedy: for each event, pick the highest-scoring unused voice. Ties and
  // zero-score events fall back to the next unused voice in shuffled order
  // (deterministic via seed). Once pool is exhausted, cycle through shuffled.
  const used = new Set<string>();
  let cycleIdx = 0;
  for (const evt of events) {
    let bestVoice: Voice | undefined;
    let bestScore = 0;
    for (const v of shuffled) {
      if (used.has(v.name)) {
        continue;
      }
      const s = scoreVoiceAgainstEvent(v, evt);
      if (s > bestScore) {
        bestScore = s;
        bestVoice = v;
      }
    }
    if (!bestVoice) {
      // No tag match (or pool exhausted) — fall back to next unused in
      // shuffled order; if none unused, cycle.
      for (const v of shuffled) {
        if (!used.has(v.name)) {
          bestVoice = v;
          break;
        }
      }
    }
    if (!bestVoice) {
      // Fully exhausted — cycle deterministically through the shuffled pool.
      bestVoice = shuffled[cycleIdx % shuffled.length] as Voice;
      cycleIdx++;
    } else {
      used.add(bestVoice.name);
    }
    out.set(evt.id, bestVoice);
  }
  return out;
}

function resolveVoicePool(names: readonly string[] | undefined): Voice[] {
  if (!names || names.length === 0) {
    return BUILT_IN_VOICES.slice();
  }
  const byName = new Map(BUILT_IN_VOICES.map((v) => [v.name, v]));
  const resolved: Voice[] = [];
  const unknown: string[] = [];
  for (const n of names) {
    const v = byName.get(n);
    if (!v) {
      unknown.push(n);
    } else {
      resolved.push(v);
    }
  }
  if (unknown.length > 0) {
    throw new Error(`Unknown voice name(s): ${unknown.join(", ")}`);
  }
  return resolved;
}

// Pure helper: combine fetched events + assignment + (optional) mortality
// into the structured output. Extracted so the wiring is unit-testable.
export function buildMixedPersonasResult(
  args: ListEventsInMixedPersonasArgs,
  events: CalendarEvent[],
): ListEventsInMixedPersonasResult {
  const pool = resolveVoicePool(args.voice_pool);
  const sorted = events.toSorted((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const assignment = assignVoices(sorted, pool, args.assignment_strategy, args.seed);

  const poolExhausted =
    args.assignment_strategy !== "sequential" && sorted.length > pool.length && pool.length > 0;

  let mortalityById: Map<string, number> | undefined;
  if (args.include_mortality) {
    const baseline = buildBaseline({
      start_date: args.start_date,
      end_date: args.end_date,
      expected_lifespan_years: DEFAULT_LIFESPAN_YEARS,
      waking_hours_per_day: DEFAULT_WAKING_HOURS,
    });
    const { events: augmented } = computeMortalityFields(sorted, baseline);
    mortalityById = new Map(augmented.map((e) => [e.id, e.life_percent_consumed]));
  }

  const usedSet = new Set<string>();
  const outEvents: MixedPersonaEvent[] = sorted.map((evt) => {
    const voice = assignment.get(evt.id);
    if (!voice) {
      // Defensive: assignVoices covers every event when pool is non-empty.
      throw new Error(`Voice assignment missing for event id=${evt.id}`);
    }
    usedSet.add(voice.name);
    const out: MixedPersonaEvent = {
      id: evt.id,
      title: evt.title,
      start: evt.start,
      end: evt.end,
      all_day: evt.all_day,
      calendar_name: evt.calendar_name,
      voice_name: voice.name,
      voice_directive: voice.directive,
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
    if (mortalityById) {
      const pct = mortalityById.get(evt.id);
      if (pct !== undefined) {
        out.life_percent_consumed = pct;
      }
    }
    return out;
  });

  return {
    events: outEvents,
    voices_used: Array.from(usedSet),
    voice_pool_size: pool.length,
    pool_exhausted_warning: poolExhausted,
    assignment_strategy: args.assignment_strategy,
    rewrite_instructions: REWRITE_INSTRUCTIONS,
  };
}

export async function listEventsInMixedPersonas(
  args: ListEventsInMixedPersonasArgs,
): Promise<ListEventsInMixedPersonasResult> {
  const events = await collectEvents(args);
  return buildMixedPersonasResult(args, events);
}

async function collectEvents(args: ListEventsInMixedPersonasArgs): Promise<CalendarEvent[]> {
  const baseArgs = {
    start_date: args.start_date,
    end_date: args.end_date,
    limit: 500,
  };
  if (!args.calendars || args.calendars.length === 0) {
    return listEvents(baseArgs);
  }
  const results = await mapWithConcurrency(
    args.calendars,
    MIXED_PERSONAS_FAN_OUT_CONCURRENCY,
    (name) => listEvents({ ...baseArgs, calendar_name: name }),
  );
  return results.flat();
}
