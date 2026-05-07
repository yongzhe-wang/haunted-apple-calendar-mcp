import { BUILT_IN_PERSONAS, type BuiltInPersonaName } from "../personas.js";
import type {
  CalendarEvent,
  ListEventsInPersonaArgs,
  ListEventsInPersonaResult,
} from "../types.js";
import { listEvents } from "./list-events.js";

export const REWRITE_INSTRUCTIONS =
  "For each event in `events`, rewrite the user-visible fields (title, location, notes) by applying `persona_directive`. Do not modify `id`, `start`, `end`, `all_day`, `calendar_name`, or `url`. Preserve the original event order. Output one rewritten block per event.";

// Cap parallel osascript fan-out. Each Calendar.app query can take 60-90s on
// large calendars (see OSASCRIPT_TIMEOUT_MS rationale); spawning 20 of them
// at once would stampede CPU and memory. Four is enough to overlap I/O wait
// without producing a noticeable load spike on the user's Mac.
const PERSONA_FAN_OUT_CONCURRENCY = 4;

// Pure helper: takes already-fetched events and returns the structured
// output. Extracted from the async wrapper so persona resolution and
// rewrite-instruction wiring can be unit-tested without spawning osascript.
export function buildPersonaResult(
  args: ListEventsInPersonaArgs,
  events: CalendarEvent[],
): ListEventsInPersonaResult {
  const personaDirective =
    args.persona === "custom"
      ? (args.custom_directive ?? "").trim()
      : BUILT_IN_PERSONAS[args.persona as BuiltInPersonaName];

  // The schema refinement guarantees a non-empty custom_directive when
  // persona is "custom", so this is a defensive check for type narrowing.
  if (!personaDirective) {
    throw new Error("persona_directive resolved to empty string");
  }

  return {
    persona_name: args.persona,
    persona_directive: personaDirective,
    events,
    rewrite_instructions: REWRITE_INSTRUCTIONS,
  };
}

export async function listEventsInPersona(
  args: ListEventsInPersonaArgs,
): Promise<ListEventsInPersonaResult> {
  const events = await collectEvents(args);
  return buildPersonaResult(args, events);
}

// Tiny bounded-concurrency map. Inline so we don't pull in p-limit; the
// scheduler is just N workers each draining a shared cursor.
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length });
  let i = 0;
  const workerCount = Math.min(limit, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) {
        return;
      }
      const item = items[idx];
      // noUncheckedIndexedAccess: idx is < items.length, so item is defined.
      // The `if` keeps the type checker happy without a non-null assertion.
      if (item === undefined) {
        continue;
      }
      results[idx] = await fn(item);
    }
  });
  await Promise.all(workers);
  return results;
}

async function collectEvents(args: ListEventsInPersonaArgs): Promise<CalendarEvent[]> {
  const baseArgs = {
    start_date: args.start_date,
    end_date: args.end_date,
    limit: 500,
  };
  if (!args.calendars || args.calendars.length === 0) {
    return listEvents(baseArgs);
  }
  // Fan out per requested calendar so the caller can pin a specific subset.
  // listEvents already de-dupes; we re-merge here keeping start-asc order.
  const results = await mapWithConcurrency(args.calendars, PERSONA_FAN_OUT_CONCURRENCY, (name) =>
    listEvents({ ...baseArgs, calendar_name: name }),
  );
  return results.flat().toSorted((a, b) => Date.parse(a.start) - Date.parse(b.start));
}
