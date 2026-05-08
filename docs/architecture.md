# Architecture

HAUNTED (`haunted-mcp`) is a single-process Node 22 binary that speaks the [Model Context Protocol](https://modelcontextprotocol.io) over stdio and shells out to macOS `osascript` to drive Calendar.app. Everything else — schemas, parsing, character logic, memory — is plain TypeScript inside the same process.

## High-level diagram

```
┌──────────────────────┐    JSON-RPC frames     ┌──────────────────┐
│  Claude / MCP client │ ─────── stdio ───────▶ │  haunted-mcp      │
│  (Claude Desktop,    │ ◀───── stderr logs ─── │  (Node 22, ESM)  │
│   Claude Code, …)    │                        └────────┬─────────┘
└──────────────────────┘                                 │ spawn
                                                         ▼
                                                ┌──────────────────┐
                                                │  /usr/bin/       │
                                                │   osascript      │
                                                └────────┬─────────┘
                                                         │ Apple Events
                                                         ▼
                                                ┌──────────────────┐
                                                │  Calendar.app    │
                                                │  (TCC-protected) │
                                                └──────────────────┘

State on disk:
  ~/.apple-calendar-mcp/
    memory.json                    # v2: events + people + topics + user_notes + external_facts
    characters.json                # user-defined characters (optional)
    last_apply_backup_*.json       # per-batch revert snapshots
```

## The 9-stage HAUNTED pipeline (v0.5)

Memory is a **user model** that grows from every input — Gmail screenshots, free text, URLs — not just past calendar events. Web research happens BEFORE character composition so the LLM has external facts (course descriptions, professor bios, etc.) to draw from when voicing per-event reminders.

```
0. INPUT             (Claude receives a screenshot / message / URL / free text)
1. EXTRACT           extract_entities_from_input
2. RESEARCH          research_entities → (Claude WebSearch/WebFetch) → cache_research_facts
3. MEMORY UPDATE     update_memory_from_input
4. CALENDAR ACTION   create_event / update_event / delete_event
5. CHARACTER SELECT  enrich_with_character_reminders
6. CONTEXT BUILD     query_full_context_for_event
7. COMPOSE           (Claude only — REWRITE_INSTRUCTIONS_V2, anti-fabrication)
8. APPLY             apply_character_reminders
9. FEEDBACK LOOP     mutated event back into memory on next seed/extract
```

Schema v2 (`src/memory.ts`):

| Field            | Shape                                    | Purpose                                     |
| ---------------- | ---------------------------------------- | ------------------------------------------- |
| `events`         | `MemoryEvent[]`                          | Calendar history (existing).                |
| `people`         | `Record<lowercase_name, PersonRecord>`   | Named humans across all inputs.             |
| `topics`         | `Record<lowercase_name, TopicRecord>`    | Courses / event types / domains / clubs.    |
| `user_notes`     | `UserNote[]`                             | Verbatim user statements with source label. |
| `external_facts` | `Record<lowercase_entity, ExternalFact>` | 7-day-TTL web-research summaries.           |

v1 memory files load unchanged. Missing maps default to empty.

The diagram is the whole story. There is no daemon, no web server, no native module, no database. The only subprocess HAUNTED ever spawns is `osascript`.

## Three invariants

These don't bend.

### 1. stdio is the transport

`stdout` belongs to the MCP protocol — every byte on it must be a valid JSON-RPC frame. Logs, debug, status messages, warnings: all go to `process.stderr`. `console.log` is banned in production code paths because it writes to stdout and corrupts the framing.

The fix when something goes wrong is always the same: route the write to `process.stderr.write(...)` with the `[haunted-mcp]` prefix. See `src/index.ts` and `src/tools/list-events.ts` for the pattern.

### 2. Only `osascript` is spawned

No `fetch`, no native bindings, no Swift/Objective-C, no `~/Library/Calendars/` filesystem reads. HAUNTED talks to Calendar.app exclusively through `osascript`, which means Calendar.app handles auth, sharing, iCloud sync, and recurring-rule expansion for us. We don't reinvent.

The wrapper lives in `src/applescript.ts` and exposes one function: `runAppleScript(source: string): Promise<string>`. It enforces a 30-second default timeout (`OSASCRIPT_TIMEOUT_MS`) and a 16 MiB output buffer (`OSASCRIPT_MAX_BUFFER`) — both intentional ceilings against runaway scripts.

### 3. `escapeAppleScriptString` is the only path for untrusted strings into AppleScript

Every string that originates outside HAUNTED's source code (titles, notes, locations, calendar names, event ids, urls, query strings) MUST go through `escapeAppleScriptString` from `src/applescript.ts` before it lands inside an AppleScript source literal. Dates use `isoToAppleScriptDate`, never string interpolation — AppleScript's `date "..."` literal is locale-sensitive and would silently misparse on a French Mac.

Tests in `test/applescript.test.ts` are the contract. If you write new AppleScript-construction code, add an injection-payload test (quotes + shell-out + control chars) that asserts the escaped form appears.

## Three-phase tool pattern

Every tool file in `src/tools/*.ts` has the same shape:

```ts
// Pure: builds an AppleScript source string from validated args.
export function buildXScript(args: XInput): string { ... }

// Pure: parses the RS/US-delimited osascript output into a typed result.
export function parseXOutput(raw: string): XOutput { ... }

// Async: runs build → osascript → parse, returns the typed result.
export async function x(args: XInput): Promise<XOutput> { ... }
```

The two pure phases are the **testable surface**. The async wrapper is integration-only — we never mock `osascript`, and we never run it in unit tests.

## Output parsing: RS / US separators

`osascript` returns whatever its `return` expression evaluates to as a single string. To make that string deterministically parseable across Unicode, commas, newlines, and quotes inside event fields, the AppleScript source emits records joined by ASCII Record Separator (`0x1E`) and fields joined by Unit Separator (`0x1F`). The TS side splits with two `.split(...)` calls.

These separators are **not** a security boundary — they're a parsing convenience. Strings still need `escapeAppleScriptString` on the way in.

## Event identity

The MCP-visible `id` field on every event is Calendar.app's own `uid` — the UUID-shaped identifier Apple assigns. It's stable across moves between calendars, app restarts, and iCloud sync round-trips. We never synthesize ids from titles, indexes, or hashes. See [ADR 0003](adr/0003-uid-as-event-id.md).

The one exception: when `update_event` moves an event between calendars (different accounts), the AppleScript path is copy-then-delete, which assigns a new `uid` to the copy. The new id is returned to the caller; the old id is no longer valid. Callers caching ids must refresh after a cross-account move.

## Memory layer

`src/memory.ts` owns `~/.apple-calendar-mcp/memory.json` — a flat snapshot of past events seeded by `seed_calendar_memory`. It's read by `enrich_with_character_reminders` and `query_calendar_memory`. The file is written with mode `0600`. There is no remote sync. The directory path is `~/.apple-calendar-mcp/` for backwards compatibility with v0.1.x users; the rename to HAUNTED did not move the data directory.

## Character layer

`src/characters.ts` owns the built-in `BUILT_IN_CHARACTERS` array (Mom, Friend, Coach, Therapist, Past-you, Future-you, Werner, Aurelius, Barkeep, Old friend, 夫子, Dog) and the loader for `~/.apple-calendar-mcp/characters.json` (user-defined extras). The same loader accepts an inline `custom_characters` array on the tool call, so users can experiment without touching disk.

## Where to start reading

- `src/index.ts` — the MCP server bootstrap and the tool registration table.
- `src/applescript.ts` — the escape function and the `osascript` wrapper.
- `src/tools/list-events.ts` — a complete worked example of the three-phase pattern with non-trivial parsing (recurring expansion, per-calendar fan-out).
- `src/tools/apply-character-reminders.ts` — the most write-heavy tool; shows the backup-and-revert convention.
