import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { formatUserFacingError } from "./errors.js";
import { createEvent } from "./tools/create-event.js";
import { deleteEvent } from "./tools/delete-event.js";
import { listCalendars } from "./tools/list-calendars.js";
import { listEventsInPersona } from "./tools/list-events-in-persona.js";
import { listEvents } from "./tools/list-events.js";
import { searchEvents } from "./tools/search-events.js";
import { timePerCalendar } from "./tools/time-per-calendar.js";
import { updateEvent } from "./tools/update-event.js";
import {
  CreateEventInput,
  DeleteEventInput,
  ListEventsInPersonaInput,
  ListEventsInPersonaInputObject,
  ListEventsInput,
  SearchEventsInput,
  TimePerCalendarInput,
  TimePerCalendarInputObject,
  UpdateEventInput,
} from "./types.js";

type ToolContent = { type: "text"; text: string };

function ok(data: unknown): { content: ToolContent[] } {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function fail(err: unknown): { content: ToolContent[]; isError: true } {
  // Stderr only — stdout is the MCP transport channel.
  process.stderr.write(`[apple-calendar-mcp] ${String(err)}\n`);
  return {
    content: [{ type: "text", text: formatUserFacingError(err) }],
    isError: true,
  };
}

async function main(): Promise<void> {
  const server = new McpServer(
    {
      name: "apple-calendar-mcp",
      version: "0.1.0",
    },
    {
      capabilities: { tools: {} },
    },
  );

  server.registerTool(
    "list_calendars",
    {
      title: "List calendars",
      description:
        "List all calendars available in macOS Calendar.app, including whether each is writable.",
      inputSchema: {},
    },
    async () => {
      try {
        return ok(await listCalendars());
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "list_events",
    {
      title: "List events",
      description:
        "List events in Calendar.app between start_date and end_date (ISO 8601). Optionally filter by calendar.",
      inputSchema: ListEventsInput.shape,
    },
    async (args) => {
      try {
        const parsed = ListEventsInput.parse(args);
        return ok(await listEvents(parsed));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "search_events",
    {
      title: "Search events",
      description:
        "Search events by substring match against title, location, and notes (case-insensitive). Defaults to 30 days ago through 90 days from now.",
      inputSchema: SearchEventsInput.shape,
    },
    async (args) => {
      try {
        const parsed = SearchEventsInput.parse(args);
        return ok(await searchEvents(parsed));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "create_event",
    {
      title: "Create event",
      description:
        "Create a new calendar event. calendar_name defaults to the first writable calendar.",
      inputSchema: CreateEventInput.shape,
    },
    async (args) => {
      try {
        const parsed = CreateEventInput.parse(args);
        return ok(await createEvent(parsed));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "update_event",
    {
      title: "Update event",
      description:
        "Update fields of an existing event identified by event_id (its uid). Only provided fields are changed. " +
        "When calendar_name changes to a different calendar, the event is copied to the target and the source is deleted, " +
        "so the returned id will be a NEW uid (cache it). Target calendar names are matched case-insensitively and with " +
        "trimmed whitespace against list_calendars. Recurring events cannot be moved across calendars (returns an error) " +
        "until v0.2 — edit the series in Calendar.app directly.",
      inputSchema: UpdateEventInput.shape,
    },
    async (args) => {
      try {
        const parsed = UpdateEventInput.parse(args);
        return ok(await updateEvent(parsed));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "time_per_calendar",
    {
      title: "Time per calendar",
      description:
        "Aggregate event durations per calendar within a time window. Returns timed seconds, event counts, " +
        "all-day counts, and percentage of the window each calendar consumed. Common read-only calendars " +
        "(US/CN holidays, birthdays, Siri Suggestions, Scheduled Reminders) are excluded by default.",
      inputSchema: TimePerCalendarInputObject.shape,
    },
    async (args) => {
      try {
        const parsed = TimePerCalendarInput.parse(args);
        return ok(await timePerCalendar(parsed));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "list_events_in_persona",
    {
      title: "List events in persona",
      description:
        "List events between start_date and end_date and return them alongside a persona directive that " +
        "tells the calling LLM how to rewrite each event. Built-in personas: werner_herzog, hemingway, " +
        "four_year_old, asian_mom, marcus_aurelius, anxious_golden_retriever. Use persona='custom' with " +
        "custom_directive for a freeform style.",
      inputSchema: ListEventsInPersonaInputObject.shape,
    },
    async (args) => {
      try {
        const parsed = ListEventsInPersonaInput.parse(args);
        return ok(await listEventsInPersona(parsed));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "delete_event",
    {
      title: "Delete event",
      description: "Delete an event by its event_id (uid).",
      inputSchema: DeleteEventInput.shape,
    },
    async (args) => {
      try {
        const parsed = DeleteEventInput.parse(args);
        return ok(await deleteEvent(parsed));
      } catch (err) {
        return fail(err);
      }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[apple-calendar-mcp] ready on stdio\n");
}

main().catch((err) => {
  process.stderr.write(`[apple-calendar-mcp] fatal: ${String(err)}\n`);
  process.exit(1);
});
