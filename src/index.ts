import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { formatUserFacingError } from "./errors.js";
import { applyCharacterReminders } from "./tools/apply-character-reminders.js";
import { CacheResearchFactsInput, cacheResearchFacts } from "./tools/cache-research-facts.js";
import { createEvent } from "./tools/create-event.js";
import { deleteEvent } from "./tools/delete-event.js";
import { distillVoiceFromText } from "./tools/distill-voice-from-text.js";
import { enrichWithCharacterReminders } from "./tools/enrich-with-character-reminders.js";
import {
  ExtractEntitiesFromInputInput,
  extractEntitiesFromInput,
} from "./tools/extract-entities-from-input.js";
import { listCalendars } from "./tools/list-calendars.js";
import { listDistillers } from "./tools/list-distillers.js";
import { listEventsInMixedPersonas } from "./tools/list-events-in-mixed-personas.js";
import { listEventsInPersona } from "./tools/list-events-in-persona.js";
import { listEvents } from "./tools/list-events.js";
import { mortalityOverlay } from "./tools/mortality-overlay.js";
import { runMemoryQuery } from "./tools/query-calendar-memory.js";
import {
  QueryFullContextForEventInput,
  QueryFullContextForEventInputObject,
  queryFullContextForEvent,
} from "./tools/query-full-context-for-event.js";
import { ResearchEntitiesInput, researchEntities } from "./tools/research-entities.js";
import { revertCharacterReminders } from "./tools/revert-character-reminders.js";
import { searchEvents } from "./tools/search-events.js";
import { seedCalendarMemory } from "./tools/seed-calendar-memory.js";
import { timePerCalendar } from "./tools/time-per-calendar.js";
import { updateEvent } from "./tools/update-event.js";
import {
  UpdateMemoryFromInputInput,
  updateMemoryFromInput,
} from "./tools/update-memory-from-input.js";
import {
  ApplyCharacterRemindersInput,
  CreateEventInput,
  DeleteEventInput,
  DistillVoiceFromTextInput,
  EnrichWithCharacterRemindersInput,
  EnrichWithCharacterRemindersInputObject,
  ListDistillersInput,
  ListEventsInMixedPersonasInput,
  ListEventsInMixedPersonasInputObject,
  ListEventsInPersonaInput,
  ListEventsInPersonaInputObject,
  ListEventsInput,
  MortalityOverlayInput,
  MortalityOverlayInputObject,
  QueryCalendarMemoryInput,
  QueryCalendarMemoryInputObject,
  RevertCharacterRemindersInput,
  SearchEventsInput,
  SeedCalendarMemoryInput,
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
  process.stderr.write(`[haunted-mcp] ${String(err)}\n`);
  return {
    content: [{ type: "text", text: formatUserFacingError(err) }],
    isError: true,
  };
}

async function main(): Promise<void> {
  const server = new McpServer(
    {
      name: "haunted-apple-calendar-mcp",
      version: "0.5.0",
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
    "list_events_in_mixed_personas",
    {
      title: "List events in mixed personas",
      description:
        "Wraps list_events and assigns a distinct voice from a 30+ pool to each event (no two events share a voice). Optional thematic mapping (DMV->Kafka, exam->Plath, etc.). Distinct-voice mortality calendar.",
      inputSchema: ListEventsInMixedPersonasInputObject.shape,
    },
    async (args) => {
      try {
        const parsed = ListEventsInMixedPersonasInput.parse(args);
        return ok(await listEventsInMixedPersonas(parsed));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "mortality_overlay",
    {
      title: "Mortality overlay",
      description:
        "Wraps list_events and attaches a per-event life_percent_consumed (and cumulative running total) so callers can frame each event as a fraction of an expected lifetime. Memento mori overlay.",
      inputSchema: MortalityOverlayInputObject.shape,
    },
    async (args) => {
      try {
        const parsed = MortalityOverlayInput.parse(args);
        return ok(await mortalityOverlay(parsed));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "seed_calendar_memory",
    {
      title: "Seed calendar memory",
      description:
        "Snapshot past events from writable calendars into ~/.apple-calendar-mcp/memory.json so character reminders can reference real prior events. Defaults to the last 5 years.",
      inputSchema: SeedCalendarMemoryInput.shape,
    },
    async (args) => {
      try {
        const parsed = SeedCalendarMemoryInput.parse(args);
        return ok(await seedCalendarMemory(parsed));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "query_calendar_memory",
    {
      title: "Query calendar memory",
      description:
        "Read seeded calendar memory by person, topic, date range, calendar, similarity to a synthetic event, or all. Returns matches plus total_in_memory.",
      inputSchema: QueryCalendarMemoryInputObject.shape,
    },
    async (args) => {
      try {
        const parsed = QueryCalendarMemoryInput.parse(args);
        return ok(runMemoryQuery(parsed));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "enrich_with_character_reminders",
    {
      title: "Enrich with character reminders",
      description:
        "List events in a window and attach a relational character (Mom, Friend, Coach, Past-you, etc.) plus per-event memory_context drawn from seeded memory, so Claude can compose one-sentence reminders that reference real prior events.",
      inputSchema: EnrichWithCharacterRemindersInputObject.shape,
    },
    async (args) => {
      try {
        const parsed = EnrichWithCharacterRemindersInput.parse(args);
        return ok(await enrichWithCharacterReminders(parsed));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "apply_character_reminders",
    {
      title: "Apply character reminders",
      description:
        "Mutate calendar event titles using Claude-composed `new_title` strings. Stores the original title/notes/location inside the event's notes (backup block) and writes a snapshot file for batch revert. Supports dry_run.",
      inputSchema: ApplyCharacterRemindersInput.shape,
    },
    async (args) => {
      try {
        const parsed = ApplyCharacterRemindersInput.parse(args);
        return ok(await applyCharacterReminders(parsed));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "revert_character_reminders",
    {
      title: "Revert character reminders",
      description:
        "Find every event in the window whose notes contain the backup sentinel, restore the original title/notes/location, and remove the backup block. If no window is given, scans -5y..+1y across writable calendars.",
      inputSchema: RevertCharacterRemindersInput.shape,
    },
    async (args) => {
      try {
        const parsed = RevertCharacterRemindersInput.parse(args);
        return ok(await revertCharacterReminders(parsed));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "list_distillers",
    {
      title: "List distillers",
      description:
        "List built-in distillers (synthetic voices distilled from public material — Garry Tan, PG, Naval, Karpathy, Steve Jobs, Munger, Bezos, etc.) plus user-defined ones. Voices are synthetic; not endorsed.",
      inputSchema: ListDistillersInput.shape,
    },
    async (args) => {
      try {
        const parsed = ListDistillersInput.parse(args);
        return ok(await listDistillers(parsed));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "distill_voice_from_text",
    {
      title: "Distill voice from text",
      description:
        "Take a corpus of someone's public writing/talks/tweets and return a draft Distiller object plus instructions for the calling LLM to fill in the voice directive and signature phrases. Output voices are synthetic; not endorsed.",
      inputSchema: DistillVoiceFromTextInput.shape,
    },
    async (args) => {
      try {
        const parsed = DistillVoiceFromTextInput.parse(args);
        return ok(await distillVoiceFromText(parsed));
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

  server.registerTool(
    "extract_entities_from_input",
    {
      title: "Extract entities from input",
      description:
        "Stage 1 of HAUNTED pipeline. Returns a structured extraction schema instructing Claude to parse a screenshot/message into events, people, topics, statements, intent.",
      inputSchema: ExtractEntitiesFromInputInput.shape,
    },
    async (args) => {
      try {
        const parsed = ExtractEntitiesFromInputInput.parse(args);
        return ok(await extractEntitiesFromInput(parsed));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "research_entities",
    {
      title: "Research entities",
      description:
        "Stage 2. Returns cached external_facts plus a research directive for entities not yet known. Claude does web search at its layer and calls cache_research_facts.",
      inputSchema: ResearchEntitiesInput.shape,
    },
    async (args) => {
      try {
        const parsed = ResearchEntitiesInput.parse(args);
        return ok(await researchEntities(parsed));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "cache_research_facts",
    {
      title: "Cache research facts",
      description:
        "Stage 2 follow-up. Persists Claude's web-research findings into ~/.apple-calendar-mcp/memory.json's external_facts map (7-day TTL).",
      inputSchema: CacheResearchFactsInput.shape,
    },
    async (args) => {
      try {
        const parsed = CacheResearchFactsInput.parse(args);
        return ok(await cacheResearchFacts(parsed));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "update_memory_from_input",
    {
      title: "Update memory from input",
      description:
        "Stage 3. Bulk-merges extraction results + research into memory's events / people / topics / user_notes maps.",
      inputSchema: UpdateMemoryFromInputInput.shape,
    },
    async (args) => {
      try {
        const parsed = UpdateMemoryFromInputInput.parse(args);
        return ok(await updateMemoryFromInput(parsed));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "query_full_context_for_event",
    {
      title: "Query full context for event",
      description:
        "Stage 6. Returns the full context bundle (memory + people + topics + external facts + user notes) for one event so Claude can compose substantive voice commentary.",
      inputSchema: QueryFullContextForEventInputObject.shape,
    },
    async (args) => {
      try {
        const parsed = QueryFullContextForEventInput.parse(args);
        return ok(await queryFullContextForEvent(parsed));
      } catch (err) {
        return fail(err);
      }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[haunted-mcp] ready on stdio\n");
}

main().catch((err) => {
  process.stderr.write(`[haunted-mcp] fatal: ${String(err)}\n`);
  process.exit(1);
});
