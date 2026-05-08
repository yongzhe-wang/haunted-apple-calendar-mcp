# Contributing to HAUNTED

Thanks for your interest. HAUNTED is small enough that drive-by contributions are welcome.

## Quick checks before opening a PR

- `pnpm install`
- `pnpm check` (typecheck + lint + format + knip + test)

## Architecture

See [docs/architecture.md](docs/architecture.md). Three rules that don't bend:

1. **stdio is the transport.** Logs go to stderr; stdout is reserved for MCP protocol frames.
2. **Only `osascript` is spawned.** No network, no fs writes outside `~/.apple-calendar-mcp/`.
3. **`escapeAppleScriptString` is the only path for untrusted strings into AppleScript source.**

If your PR touches AppleScript-construction code, **add an injection-payload test** that asserts the escape happened. See `test/applescript.test.ts` for the spec.

## Adding a new tool

See [docs/architecture.md](docs/architecture.md) and the existing `src/tools/*.ts` files. Each tool has the same three-phase shape:

```
buildXScript(args) -> string         (pure, AppleScript source)
parseXOutput(raw)  -> TOut           (pure, parses RS/US output)
x(args)            -> Promise<TOut>  (async, runs osascript + parses)
```

The pure phases are unit-tested with vitest; the async wrapper is integration-tested by the user.

## Adding a new character

See `src/characters.ts`. Built-in characters are in `BUILT_IN_CHARACTERS`. Each needs:

- `name` (human-readable)
- `short_label` (≤16 chars, used in calendar title)
- `directive` (≤300 chars, with explicit "reference at least one memory_context item" instruction)
- `triggers` (lowercase keywords — what event titles this character fits)

Variation principle: every directive must include guidance to vary openers/cadence.

## License

MIT. By submitting a PR you agree your contribution is licensed under MIT.
