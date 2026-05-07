# AGENTS.md

Telegraph style. Root rules only. This file is for AI coding agents opening this repo.

## Project

- **Name:** `apple-calendar-mcp`
- **Purpose:** MCP server exposing macOS Calendar.app to Claude (and any other MCP client) via AppleScript.
- **Scope:** single-package, single-binary CLI. Six tools. Stdio transport only.
- **Platform:** macOS only (`package.json` declares `"os": ["darwin"]`).
- **Runtime:** Node 22.14+.
- **Package manager:** pnpm 10.33.0 (see `packageManager` field).
- **Repo:** <https://github.com/yongzhe-wang/apple-calendar-mcp>

## File layout

```
src/
  index.ts              # MCP server bootstrap, stdio transport, tool registration
  applescript.ts        # osascript exec wrapper + escapeAppleScriptString + isoToAppleScriptDate + parseRecords
  errors.ts             # AppleCalendarError + isPermissionError + formatUserFacingError
  types.ts              # zod schemas for all tool inputs/outputs
  tools/
    list-calendars.ts
    list-events.ts      # buildListEventsScript + parseEventsOutput + listEvents
    search-events.ts    # matchesQuery + searchEvents (TS-side filter, reuses listEvents)
    create-event.ts     # buildCreateEventScript + createEvent
    update-event.ts     # buildUpdateEventScript + updateEvent
    delete-event.ts     # buildDeleteEventScript + deleteEvent
test/
  applescript.test.ts   # escape/date/parse helpers
  tools.test.ts         # per-tool script builders + parsers + schemas
```

Each tool module follows the same shape:

1. A pure `build*Script(args)` that returns the AppleScript source.
2. A pure `parse*Output(raw)` where applicable.
3. An async top-level function that runs `build*Script`, calls `runAppleScript`, parses, and returns a typed result.

The pure functions are the **testable surface**. The async wrappers are not unit tested — they hit `osascript`.

## Commands

- Install: `pnpm install`
- Build: `pnpm build` → `dist/index.js` (ESM, `#!/usr/bin/env node` banner, `chmod +x`)
- Dev watch: `pnpm dev`
- Test: `pnpm test` (vitest run)
- Test watch: `pnpm test:watch`
- Coverage: `pnpm test:coverage`
- Typecheck: `pnpm typecheck` (`tsc --noEmit`)
- Lint: `pnpm lint` (oxlint) / `pnpm lint:fix`
- Format: `pnpm format:check` / `pnpm format`
- Dead code: `pnpm knip`
- Gate: `pnpm check` → typecheck + lint + format:check + knip

## Architecture invariants

- **stdio is the transport.** `stdout` belongs to the MCP protocol. Every log / debug / status message goes to `process.stderr`. `console.log` is banned in production code paths.
- **Only `osascript` is spawned.** No other child process. No network. No filesystem access outside what Calendar.app does.
- **`escapeAppleScriptString` is the only sanctioned path for untrusted strings into AppleScript.** Every tool-argument string (title, notes, location, calendar_name, event_id, url) must pass through it. Dates use `isoToAppleScriptDate`, never string-interpolated.
- **Record separator `0x1E` / unit separator `0x1F`** are the parsing format. They are _not_ a security boundary — they just let parsing be `split(RS).map(r => r.split(US))` instead of CSV. Do not rely on them for escaping.
- **Event `id` is the Calendar.app `uid`** — stable, UUID-ish, survives moves and restarts. Do not synthesize ids, indexes, or hashes.
- **`noUncheckedIndexedAccess` is on.** Treat array accesses as `T | undefined`.

## Adding a new tool

1. **Add the zod schema** to `src/types.ts`. Follow the existing naming (`<Verb><Noun>Input`). Mirror the style of `CreateEventInput` / `UpdateEventInput`.
2. **Add a file** `src/tools/<kebab-name>.ts` exporting:
   - `build<PascalName>Script(args): string` — pure AppleScript source builder.
   - `parse<PascalName>Output(raw): TOut` — pure parser, if there's output to parse.
   - `<verbNoun>(args): Promise<TOut>` — the async wrapper.
3. **Register it** in `src/index.ts` via `server.registerTool(...)`. Use the existing pattern (`ok(...)` / `fail(...)` helpers). Parse the input with the zod schema.
4. **Write tests** in `test/tools.test.ts`:
   - Schema: required fields, defaults, limits.
   - `build*Script`: expected AppleScript fragments, an injection payload in every string field.
   - `parse*Output`: empty input, happy path, edge cases.
5. **If the tool spawns a second `osascript`** (e.g. create-event resolves a default calendar via `listCalendars`), keep that call in the async wrapper, not the pure builder.
6. **Update README** `## Tools` table and any relevant `## FAQ` entry.

## Code conventions

- TypeScript ESM. Strict mode. `verbatimModuleSyntax` is not on, but prefer `import type` for type-only imports.
- No `any`. Prefer `unknown` and narrow adapters.
- No `@ts-nocheck`, no `@ts-ignore`, no lint suppressions without an inline justification comment (and even then, prefer fixing the root cause).
- External boundaries use `zod`. Everything coming from a tool call is validated before it reaches business logic.
- Errors: user-facing text goes through `formatUserFacingError`. Throw `AppleCalendarError(internal, userFacing)` when you can produce a better message than the raw `osascript` stderr.
- Comments: explain **why**, not **what**. The code is short enough that "what" is obvious.
- File size: keep tool files under ~200 LOC. If they grow past that, split the script-building helpers into sibling files.
- American English spelling.

## AppleScript escaping invariant

This is the one thing you must not break.

```ts
// src/applescript.ts
export function escapeAppleScriptString(s: string): string {
  const escaped = s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}
```

Order matters: `\` is escaped before `"`. Every string that enters `osascript` must go through this function. If you see string concatenation into AppleScript source without `escapeAppleScriptString`, that's a bug, and it's the kind of bug that matters.

Tests in `test/applescript.test.ts` cover:

- Empty string.
- Embedded double-quote.
- Backslash-quote combinations.
- Injection payloads (`"; do shell script "rm -rf /"; --`).
- Unicode and newlines.

Any new string-handling code needs analogous coverage.

## Tests

- **vitest** only. No jest, no mocha.
- Tests colocated in `test/` with names matching the module.
- Never mock `osascript`. Never write a test that actually runs `osascript` — those are manual/CI-optional, not part of the unit suite.
- **Inject adversarial payloads.** When adding tests for a `build*Script` function, include at least one test that passes a malicious string with quotes and shell-out syntax, and assert the output contains the escaped form.

## CI gate

CI runs on `macos-latest` and enforces (via `.github/workflows/ci.yml`):

- `pnpm typecheck`
- `pnpm lint`
- `pnpm format:check`
- `pnpm test`
- `pnpm knip`
- `pnpm build`
- `install-smoke` — pack the tarball, install it, sanity-check the binary.

Do not land a PR with a failing gate. Do not disable rules to silence a legitimate failure.

## Git

- One logical change per commit. Rebase on `origin/main`, don't merge.
- Commit messages are imperative and short ("add recurrence handling to update_event", not "Added recurrence handling").
- Do not commit `dist/` or `node_modules/`.
- Do not commit `package-lock.json` or `yarn.lock` — this repo uses pnpm exclusively.

## Security / release

- See [`SECURITY.md`](SECURITY.md) for the threat model. The big ones: AppleScript injection, stdout-is-transport, permission scope.
- Never commit real calendar exports, event uids from production calendars, or anything under `~/Library/Calendars/`.
- Releases: bump `version` in `package.json`, add a CHANGELOG entry, tag `v<version>`, `pnpm publish`. No automated release workflow on the initial version.

## Misc footguns

- AppleScript's `date "..."` literal is **locale-sensitive**. Never use it. `isoToAppleScriptDate` constructs the date from epoch seconds precisely to avoid this.
- `location`, `description`, and `url` properties on an event can throw on access if the event doesn't have them set. Wrap reads in `try ... on error`.
- The MCP SDK version (`@modelcontextprotocol/sdk`) moves fast. When bumping, re-run the server against Claude Code manually — tool registration shape changes between majors.
- `osascript` has a hard output buffer limit. `OSASCRIPT_MAX_BUFFER = 16 MiB` in `applescript.ts` is intentional; don't raise it without thinking through DoS.
- Calendar.app is slow. `OSASCRIPT_TIMEOUT_MS = 30_000` covers most real calendars; some users have hundreds of calendars and may need more.

## Persona conventions

When adding a new built-in persona to `src/personas.ts`, include an explicit `**Variation:**` clause in the directive that lists 4–6 alternative openers and tells Claude to rotate them. Personas that lock to a single opener compress the joke to a single hit; voice should be constant, cadence should rotate. See the comment block at the top of `src/personas.ts` for the principle. The test in `test/list-events-in-persona.test.ts` enforces that every built-in directive contains the literal substring `Variation:`.
