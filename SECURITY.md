# Security

## Threat model

HECKLE is local-only. There is no network, no remote service, no credential store. The threat surface is:

1. **AppleScript injection.** Every untrusted string flowing into `osascript` MUST go through `escapeAppleScriptString` (see `src/applescript.ts`). The escape function handles `\`, `"`, `\n`, `\r`. Tests in `test/applescript.test.ts` are the contract — adversarial payloads (quotes + shell-out + control chars) must produce escaped output, never the literal payload.

2. **stdout-is-MCP-transport.** Any unintended write to stdout corrupts the MCP protocol. All log/debug output goes to `process.stderr`. No `console.log` in production paths.

3. **Permission scope.** Calendar.app full access via the macOS Automation TCC grant gives HECKLE full read/write to all calendars on the device. Users granting this access should be aware that HECKLE will be able to read and modify any calendar event in any calendar (iCloud, On-My-Mac, Google synced into Apple Calendar, etc.).

## Supported versions

HECKLE follows a rolling-release model. Only the **latest published version on npm** is supported for security fixes. Pin to `latest` in MCP client configs rather than an older version.

| Version   | Supported                                                    |
| --------- | ------------------------------------------------------------ |
| `0.2.x`   | ✅ (current)                                                 |
| `0.1.x`   | ⚠️ legacy `apple-calendar-mcp` name; migrate to `heckle-mcp` |
| `< 0.1.0` | ❌                                                           |

## Reporting a vulnerability

Please file an issue marked `security` (or, if you prefer private disclosure, email the maintainer listed in `package.json`). Do not include exploit details in public issues for issues that affect user data integrity.

Private disclosure via GitHub Security Advisories is preferred:

- <https://github.com/yongzhe-wang/apple-calendar-mcp/security/advisories/new>

## Reversibility

Tools that mutate calendar state (`create_event`, `update_event`, `delete_event`, `apply_character_reminders`) write a backup to `~/.apple-calendar-mcp/last_apply_backup_*.json` and embed a sentinel-marked backup block in the event's notes field. The `revert_character_reminders` tool restores from these. The mutation is logically reversible at any time.
