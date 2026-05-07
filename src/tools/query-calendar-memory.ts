import {
  DEFAULT_MEMORY_PATH,
  loadMemory,
  queryByCalendar,
  queryByDateRange,
  queryByPerson,
  queryByTopic,
  recentSimilarEvents,
  type MemoryEvent,
} from "../memory.js";
import type { QueryCalendarMemoryArgs, QueryCalendarMemoryResult } from "../types.js";

export function runMemoryQuery(
  args: QueryCalendarMemoryArgs,
  memoryPath: string = DEFAULT_MEMORY_PATH,
): QueryCalendarMemoryResult {
  const memory = loadMemory(memoryPath);
  let matches: MemoryEvent[] = [];
  let summary = "";
  switch (args.query_type) {
    case "by_person":
      matches = queryByPerson(memory, args.query_string ?? "");
      summary = `by_person:"${args.query_string ?? ""}"`;
      break;
    case "by_topic":
      matches = queryByTopic(memory, args.query_string ?? "");
      summary = `by_topic:"${args.query_string ?? ""}"`;
      break;
    case "by_date_range":
      matches = queryByDateRange(memory, args.start_date ?? "", args.end_date ?? "");
      summary = `by_date_range:${args.start_date}..${args.end_date}`;
      break;
    case "by_calendar":
      matches = queryByCalendar(memory, args.calendar_name ?? "");
      summary = `by_calendar:"${args.calendar_name ?? ""}"`;
      break;
    case "similar_to": {
      const e = args.event;
      if (e) {
        const similarArg: { title: string; calendar?: string; start?: string } = { title: e.title };
        if (e.calendar !== undefined) {
          similarArg.calendar = e.calendar;
        }
        if (e.start !== undefined) {
          similarArg.start = e.start;
        }
        matches = recentSimilarEvents(memory, similarArg, args.limit);
      }
      summary = `similar_to:"${e?.title ?? ""}"`;
      break;
    }
    case "all":
      matches = memory.events.slice();
      summary = "all";
      break;
  }

  // Sort newest-first for human consumption regardless of query path.
  matches.sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
  if (matches.length > args.limit) {
    matches = matches.slice(0, args.limit);
  }

  return {
    matches,
    total_in_memory: memory.events.length,
    query_summary: summary,
  };
}
