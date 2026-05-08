import { existsSync, statSync } from "node:fs";
import {
  DEFAULT_MEMORY_PATH,
  loadMemory,
  mergeEvents,
  saveMemory,
  type MemoryEvent,
} from "../memory.js";
import type { CalendarEvent, SeedCalendarMemoryArgs, SeedCalendarMemoryResult } from "../types.js";
import { mapWithConcurrency } from "../util/concurrency.js";
import { listCalendars } from "./list-calendars.js";
import { listEvents } from "./list-events.js";

const SEED_FAN_OUT_CONCURRENCY = 4;
const FIVE_YEARS_MS = 5 * 365 * 24 * 60 * 60 * 1000;

export function eventToMemoryEvent(event: CalendarEvent): MemoryEvent {
  const startMs = Date.parse(event.start);
  const endMs = Date.parse(event.end);
  const durationHours =
    Number.isFinite(startMs) && Number.isFinite(endMs)
      ? Math.max(0, (endMs - startMs) / (1000 * 60 * 60))
      : 0;
  const out: MemoryEvent = {
    uid: event.id,
    title: event.title,
    start: event.start,
    end: event.end,
    duration_hours: Number(durationHours.toFixed(4)),
    calendar: event.calendar_name,
  };
  if (event.notes) {
    out.notes = event.notes;
  }
  return out;
}

export function defaultSeedWindow(now: Date = new Date()): { start: string; end: string } {
  const end = now.toISOString();
  const start = new Date(now.getTime() - FIVE_YEARS_MS).toISOString();
  return { start, end };
}

export async function seedCalendarMemory(
  args: SeedCalendarMemoryArgs,
  memoryPath: string = DEFAULT_MEMORY_PATH,
): Promise<SeedCalendarMemoryResult> {
  const window = {
    start: args.start_date ?? defaultSeedWindow().start,
    end: args.end_date ?? defaultSeedWindow().end,
  };

  // Resolve target calendars: caller filter wins; otherwise fan out across
  // every writable calendar so seeding mirrors the data the user actually
  // controls.
  const allCalendars = await listCalendars();
  const writable = allCalendars.filter((c) => c.writable);
  const targets =
    args.calendars && args.calendars.length > 0 ? args.calendars : writable.map((c) => c.name);

  const perCalendar: { calendar: string; event_count: number }[] = [];
  const collected = await mapWithConcurrency(targets, SEED_FAN_OUT_CONCURRENCY, async (name) => {
    try {
      const events = await listEvents({
        start_date: window.start,
        end_date: window.end,
        calendar_name: name,
        limit: 500,
      });
      perCalendar.push({ calendar: name, event_count: events.length });
      return events;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[heckle-mcp] seed_calendar_memory: "${name}" failed: ${detail.slice(0, 500)}\n`,
      );
      perCalendar.push({ calendar: name, event_count: 0 });
      return [];
    }
  });

  const allEvents = collected.flat();
  const memoryEvents = allEvents.map(eventToMemoryEvent);
  const merged = mergeEvents(loadMemory(memoryPath), memoryEvents);
  saveMemory(merged, memoryPath);

  const fileSize = existsSync(memoryPath) ? statSync(memoryPath).size : 0;

  return {
    total_events_seeded: memoryEvents.length,
    per_calendar: perCalendar,
    window,
    memory_path: memoryPath,
    memory_file_size_bytes: fileSize,
  };
}
