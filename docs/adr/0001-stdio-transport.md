# ADR 0001: stdio is the MCP transport

## Status: accepted (2026-04, locked)

## Context

MCP supports multiple transports. We need to pick one and commit.

## Decision

stdio. Logs to stderr only.

## Consequences

- ✅ No port management, no daemon, no install ceremony
- ✅ Claude Desktop / Cursor / Claude Code spawn the server with `command + args`
- ❌ A stray `console.log` corrupts the protocol — must be vigilant in code review
- ❌ Cannot serve multiple clients simultaneously (one stdio per process)
