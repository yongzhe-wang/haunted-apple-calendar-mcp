# Tool reference

Fifteen MCP tools, four categories. Every tool returns a JSON object as a single text content block — that's the MCP convention HAUNTED follows. Dates are ISO 8601 throughout (`2026-05-07T14:30:00Z` or `2026-05-07T10:30:00-07:00`).

## CRUD

The original six tools. Read-and-write parity with Calendar.app.

### `list_calendars`

List every calendar visible to Calendar.app on this Mac, with a `writable` flag that reflects whether HAUNTED can mutate events on it (read-only subscribed calendars come back with `writable: false`).

- **Inputs:** none.
- **Output shape:** `{ calendars: [{ name: string, writable: boolean }] }`.
- **Source:** `src/tools/list-calendars.ts`.

### `list_events`

Fetch events in a date window across one calendar, several, or all writable calendars. Recurring weekly Calendar.app series are expanded TypeScript-side so day views match what you see in Apple Calendar.

- **Key inputs:** `start_date` (ISO), `end_date` (ISO), `calendar_name?` (string), `calendars?` (string[]), `limit?` (default 100, max 500).
- **Output shape:** `{ events: [{ id, title, calendar_name, start, end, all_day, location?, notes?, url? }] }`.
- **Source:** `src/tools/list-events.ts`.

### `search_events`

Substring match across title, location, and notes. CJK-aware — searching for `极佳` finds `極佳` matches in your `notes` field. Defaults to a 30-day-back / 90-day-forward window.

- **Key inputs:** `query` (string), `start_date?` (ISO), `end_date?` (ISO), `limit?`.
- **Output shape:** same `{ events: [...] }` as `list_events`.
- **Source:** `src/tools/search-events.ts`.

### `create_event`

Create an event on any writable calendar. Short meeting requests (under one hour) are normalized to a one-hour minimum by default, since Claude likes to ask for 15-minute placeholders that overrun.

- **Key inputs:** `title` (string), `start_date` (ISO), `end_date` (ISO), `calendar_name?` (string — defaults to your primary writable calendar), `location?`, `notes?`, `url?`, `all_day?` (bool).
- **Output shape:** `{ event: { id, title, calendar_name, start, end, all_day, ... } }`.
- **Source:** `src/tools/create-event.ts`.

### `update_event`

Modify any subset of fields on an event by `id` (the Calendar.app uid). Cross-calendar moves use a copy-then-delete path with verify-and-rollback safety; the response carries the **new** uid in that case.

- **Key inputs:** `event_id` (string), plus any optional field from `create_event`, plus `calendar_name?` to move it.
- **Output shape:** `{ event: { id, ... } }` (id may differ from input on cross-account move).
- **Source:** `src/tools/update-event.ts`. See [docs/troubleshooting.md](troubleshooting.md) on uid changes.

### `delete_event`

Delete an event by id. Affects exactly one event; raises a clear error if the uid no longer exists (often because of a cross-account move that already changed the uid).

- **Key inputs:** `event_id` (string).
- **Output shape:** `{ deleted: true }`.
- **Source:** `src/tools/delete-event.ts`.

## Analytics

### `time_per_calendar`

Sum the duration of timed events per calendar over a window. Useful for "how much of last quarter went to work vs personal vs the dog."

- **Key inputs:** `start_date` (ISO), `end_date` (ISO), `exclude_calendars?` (string[] — exact-match, case- and whitespace-sensitive), `skip_allday?` (default true).
- **Output shape:** `{ totals: [{ calendar_name, total_minutes, event_count }], grand_total_minutes }`.
- **Source:** `src/tools/time-per-calendar.ts`.

### `mortality_overlay`

The memento-mori tool. Annotates each event with the fraction of an expected waking lifetime it consumes, plus a cumulative running total over the window. With `birth_date` set, also computes "% of remaining life."

- **Key inputs:** `start_date` (ISO), `end_date` (ISO), `expected_lifespan_years?` (default 80), `waking_hours_per_day?` (default 16), `birth_date?` (ISO date), `calendars?`.
- **Output shape:** `{ events: [{ id, title, start, end, life_fraction, life_fraction_pct, cumulative_pct, remaining_life_pct? }], summary }`.
- **Source:** `src/tools/mortality-overlay.ts`.

## Personas

The persona tools don't rewrite text on the server — they return raw events plus a `*_directive` string. Claude does the rewriting client-side.

### `list_events_in_persona`

Wrap an event window with a single persona's directive. Built-ins include `werner_herzog`, `marcus_aurelius`, `kafka`, `hemingway`, `dorothy_parker`, and a dozen more.

- **Key inputs:** `persona` (string — built-in id, or `custom`), `start_date`, `end_date`, `calendars?`, `custom_directive?` (used when `persona === "custom"`).
- **Output shape:** `{ persona, persona_directive, events: [...] }`.
- **Source:** `src/tools/list-events-in-persona.ts`.

### `list_events_in_mixed_personas`

Assigns a **distinct** voice per event from a 36-voice pool, with optional thematic mapping (DMV → Kafka, exam → Plath, recurring 1:1 → noir detective). Optional "for free" mortality hint folds in `mortality_overlay` numbers.

- **Key inputs:** `start_date`, `end_date`, `calendars?`, `voice_pool?` (string[]), `assignment_strategy?` (`"thematic" | "round_robin" | "random"`), `seed?` (deterministic), `include_mortality?` (bool).
- **Output shape:** `{ assignments: [{ event, voice, voice_directive, mortality? }] }`.
- **Source:** `src/tools/list-events-in-mixed-personas.ts`.

## Character memory

The headline feature. Five tools that, together, let Claude leave one-sentence relational notes on every upcoming event — referencing things you actually did, with people you actually saw.

### `seed_calendar_memory`

Snapshot past events from writable calendars into `~/.apple-calendar-mcp/memory.json`. Defaults to the last 5 years. Run this once; re-run periodically to keep memory fresh.

- **Key inputs:** `start_date?` (defaults to 5y ago), `end_date?` (defaults to today), `calendars?`.
- **Output shape:** `{ event_count, per_calendar: [{ calendar, event_count }], memory_path }`.
- **Source:** `src/tools/seed-calendar-memory.ts`.

### `query_calendar_memory`

Read seeded memory by person, topic, date range, calendar, similarity to a synthetic event, or all. Used internally by `enrich_with_character_reminders`, but also useful directly ("what did I do with Sarah last summer?").

- **Key inputs:** `query_type` (`"person" | "topic" | "date_range" | "calendar" | "similar_event" | "all"`), plus type-specific fields (`query_string?`, `start_date?`, `end_date?`, `calendar_name?`, `event?`, `limit?`).
- **Output shape:** `{ matches: [{ id, title, calendar_name, start, end, score? }] }`.
- **Source:** `src/tools/query-calendar-memory.ts`.

### `enrich_with_character_reminders`

For each event in a window, attach a relational character (Mom, Friend, Coach, Therapist, Past-you, Future-you, Werner, Aurelius, Barkeep, Old friend, 夫子, Dog — plus any custom characters you've defined) and 3 `memory_context` items pulled from seeded memory. The character's directive instructs Claude to reference at least one of those memory items.

- **Key inputs:** `start_date`, `end_date`, `calendars?`, `character_pool?` (string[]), `include_memory_context?` (bool, default true), `memory_context_size?` (default 3), `seed?`, `custom_characters?` (inline character definitions).
- **Output shape:** `{ enriched: [{ event, character: { name, short_label, directive }, memory_context: [...] }] }`.
- **Source:** `src/tools/enrich-with-character-reminders.ts`.

### `apply_character_reminders`

Mutate event titles using the `new_title` strings Claude composed from the previous step. Embeds a sentinel-marked `---ORIGINAL_TITLE_BACKUP_v1---` block in the event's notes and writes a snapshot file at `~/.apple-calendar-mcp/last_apply_backup_*.json` for batch revert. Supports `dry_run` to see what would change without writing.

- **Key inputs:** `events_with_reminders[]` (each with `event_id`, `new_title`, optional `new_notes`/`new_location`), `dry_run?` (bool).
- **Output shape:** `{ applied: [{ event_id, before, after }], backup_path, dry_run }`.
- **Source:** `src/tools/apply-character-reminders.ts`.

### `revert_character_reminders`

Find every event whose notes carry the backup sentinel and restore the original title/notes/location. Idempotent — running it twice with no apply in between is a no-op.

- **Key inputs:** `start_date?`, `end_date?`, `calendars?`.
- **Output shape:** `{ reverted: [{ event_id, restored_title }], scan_summary }`.
- **Source:** `src/tools/revert-character-reminders.ts`.

## Distillers

### `list_distillers`

Enumerate built-in distillers (synthetic voices distilled from public material of named people — Garry Tan, Paul Graham, Naval Ravikant, Sam Altman, Steve Jobs, Andrej Karpathy, Marc Andreessen, Jeff Bezos, Charlie Munger, Brian Chesky, Joan Didion, Alan Turing, LeBron James, Hilary Hahn, Ian (Hearts2Hearts), Old Founder), plus user-defined ones from `~/.apple-calendar-mcp/distillers.json`. Every output entry carries an `attribution` field stating the voice is synthetic and not endorsed by the named individual. Use this to pick which voice will narrate calendar events.

- **Key inputs:** `worldview_filter?` (exact tag match, e.g. `"founder"`), `name_filter?` (substring), `use_persistent_config` (default `true`).
- **Output shape:** `{ distillers: [{ name, short_label, attribution, signature_phrases, worldview_tags, representative_url?, triggers? }], total, source: "built-in" | "persistent" | "merged", notice }`.
- **Source:** `src/tools/list-distillers.ts`.

### `distill_voice_from_text`

Take a corpus of someone's public writing/talks/tweets and return a draft `Distiller` object plus a set of generation instructions. The MCP server has no LLM, so the tool itself is a thin orchestrator: the calling LLM analyses `corpus_text`, fills in `directive` and `signature_phrases`, and (if the user confirms) writes the result to `~/.apple-calendar-mcp/distillers.json`. All distilled voices carry the synthetic-voice disclaimer.

- **Key inputs:** `name`, `short_label`, `corpus_text` (20–50,000 chars), `worldview_tags?`, `triggers?`, `representative_url?`.
- **Output shape:** `{ draft_distiller: { ...with PLACEHOLDER directive and empty signature_phrases }, corpus_text, generation_instructions }`.
- **Source:** `src/tools/distill-voice-from-text.ts`.

### Distillers in `enrich_with_character_reminders`

`enrich_with_character_reminders` accepts `distiller_pool[]` and `custom_distillers[]` alongside `character_pool[]` and `custom_characters[]`. Distillers and characters merge into one assignment pool; conflicts resolve by name with inline > persistent > built-in. When the assigned voice is a distiller, the per-event output also includes `distiller_attribution` and `distiller_signature_phrases` so the calling LLM has the full voice fingerprint plus the synthetic-voice disclaimer in context.

## Conventions across all tools

- **Errors** come back as `{ isError: true, content: [...] }` per the MCP spec, with user-facing messages routed through `formatUserFacingError`. Internal AppleScript errors are logged to stderr and never surface raw.
- **Dates** are always ISO 8601. Local timezones are honored via the `isoToAppleScriptDate` path; we never construct AppleScript `date "..."` literals.
- **Event ids** are Calendar.app uids. They're stable across moves, restarts, and iCloud sync — except cross-account move via `update_event`, which assigns a new uid.
- **Calendar names** are matched case- and whitespace-insensitively for _write_ paths (so `"Entertainment "` won't accidentally create a duplicate of `"Entertainment"`), and exactly for the `exclude_calendars` filter on `time_per_calendar`.
