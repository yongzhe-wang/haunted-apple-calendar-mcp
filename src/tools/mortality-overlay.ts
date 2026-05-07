import type {
  CalendarEvent,
  MortalityOverlayArgs,
  MortalityOverlayEvent,
  MortalityOverlayResult,
} from "../types.js";
import { mapWithConcurrency } from "../util/concurrency.js";
import { listEvents } from "./list-events.js";

// Cap parallel osascript fan-out. Same rationale as the persona tool — four
// workers overlap I/O wait without producing a noticeable load spike.
const MORTALITY_FAN_OUT_CONCURRENCY = 4;

const HOURS_PER_DAY = 24;
const DAYS_PER_YEAR = 365; // Memento mori vibe number, not actuarial. 365.25 implies precision the framing doesn't earn.
const MS_PER_HOUR = 3_600_000;
const MS_PER_YEAR = DAYS_PER_YEAR * HOURS_PER_DAY * MS_PER_HOUR;

export type MortalityBaseline = {
  expected_lifespan_years: number;
  waking_hours_per_day: number;
  total_waking_hours: number;
  birth_date?: string;
};

type ComputeMortalityFieldsOptions = {
  birthDate?: string;
};

// Pure helper: takes already-fetched events and the precomputed baseline
// and returns the augmented events + totals. Extracted from the async
// wrapper so the math is unit-testable without spawning osascript.
export function computeMortalityFields(
  events: CalendarEvent[],
  baseline: MortalityBaseline,
  options: ComputeMortalityFieldsOptions = {},
): { events: MortalityOverlayEvent[]; totals: MortalityOverlayResult["totals"] } {
  const sorted = events.toSorted((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const birthMs = options.birthDate !== undefined ? Date.parse(options.birthDate) : Number.NaN;
  const hasBirth = !Number.isNaN(birthMs);

  let cumulative = 0;
  let totalHours = 0;
  let totalLifePct = 0;
  let totalRemainingPct = 0;

  const augmented: MortalityOverlayEvent[] = [];
  for (const evt of sorted) {
    const startMs = Date.parse(evt.start);
    const endMs = Date.parse(evt.end);
    const rawHours = (endMs - startMs) / MS_PER_HOUR;
    // All-day events are skipped from time math (the start/end span 24h+
    // and would dominate the overlay), but kept in the output for context.
    const durationHours = evt.all_day ? 0 : Math.max(0, rawHours);
    const lifePct =
      baseline.total_waking_hours > 0 ? durationHours / baseline.total_waking_hours : 0;
    cumulative += lifePct;
    totalHours += durationHours;
    totalLifePct += lifePct;

    // Build the augmented record by direct property assignment rather than
    // spread — the spread allocates a fresh object per iteration and tripped
    // oxlint's no-map-spread rule.
    const out: MortalityOverlayEvent = {
      id: evt.id,
      title: evt.title,
      start: evt.start,
      end: evt.end,
      all_day: evt.all_day,
      calendar_name: evt.calendar_name,
      duration_hours: durationHours,
      life_percent_consumed: lifePct,
      life_percent_consumed_cumulative: cumulative,
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

    if (hasBirth) {
      const yearsAtEvent = (startMs - birthMs) / MS_PER_YEAR;
      const yearsRemaining = Math.max(0, baseline.expected_lifespan_years - yearsAtEvent);
      const remainingWakingHours = yearsRemaining * DAYS_PER_YEAR * baseline.waking_hours_per_day;
      const pctRemaining = remainingWakingHours > 0 ? durationHours / remainingWakingHours : 0;
      out.pct_of_remaining_life = pctRemaining;
      totalRemainingPct += pctRemaining;
    }

    augmented.push(out);
  }

  const totals: MortalityOverlayResult["totals"] = {
    event_count: augmented.length,
    total_hours: totalHours,
    total_life_percent: totalLifePct,
  };
  if (hasBirth) {
    totals.total_pct_of_remaining_life = totalRemainingPct;
  }

  return { events: augmented, totals };
}

export function buildBaseline(args: MortalityOverlayArgs): MortalityBaseline {
  const totalWakingHours = args.expected_lifespan_years * DAYS_PER_YEAR * args.waking_hours_per_day;
  const baseline: MortalityBaseline = {
    expected_lifespan_years: args.expected_lifespan_years,
    waking_hours_per_day: args.waking_hours_per_day,
    total_waking_hours: totalWakingHours,
  };
  if (args.birth_date !== undefined) {
    baseline.birth_date = args.birth_date;
  }
  return baseline;
}

export async function mortalityOverlay(
  args: MortalityOverlayArgs,
): Promise<MortalityOverlayResult> {
  const baseline = buildBaseline(args);
  const events = await collectEvents(args);
  const options: ComputeMortalityFieldsOptions = {};
  if (args.birth_date !== undefined) {
    options.birthDate = args.birth_date;
  }
  const { events: augmented, totals } = computeMortalityFields(events, baseline, options);
  return { baseline, events: augmented, totals };
}

async function collectEvents(args: MortalityOverlayArgs): Promise<CalendarEvent[]> {
  const baseArgs = {
    start_date: args.start_date,
    end_date: args.end_date,
    limit: 500,
  };
  if (!args.calendars || args.calendars.length === 0) {
    return listEvents(baseArgs);
  }
  // Fan out per requested calendar so the caller can pin a specific subset.
  // listEvents already de-dupes; computeMortalityFields re-sorts.
  const results = await mapWithConcurrency(args.calendars, MORTALITY_FAN_OUT_CONCURRENCY, (name) =>
    listEvents({ ...baseArgs, calendar_name: name }),
  );
  return results.flat();
}
