# macOS permissions

HECKLE drives Calendar.app via `osascript`. macOS treats that as automation, which is gated by the TCC (Transparency, Consent, and Control) subsystem. You'll see one or two permission prompts the first time HECKLE runs — accept them and you're done.

## What HECKLE needs

| Permission                | Where                                                                              | Why                                                           |
| ------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **Automation → Calendar** | System Settings → Privacy & Security → Automation → _(controlling app)_ → Calendar | Lets `osascript` send Apple Events to Calendar.app. Required. |
| **Calendars**             | System Settings → Privacy & Security → Calendars → _(controlling app)_             | Some macOS versions require this in addition to Automation.   |
| **Full Disk Access**      | —                                                                                  | Not required. HECKLE never touches `~/Library/Calendars/`.    |
| **Network**               | —                                                                                  | Not required. There is no network code path.                  |

The "controlling app" is whichever process spawned `npx heckle-mcp`. If you launched Claude Code from Terminal.app, it's Terminal. If you launched it from iTerm or Warp or VS Code or Cursor, it's that. The permission is granted per-controlling-app, not per-`osascript`.

## Step-by-step (first run)

1. Add HECKLE to your MCP client config (see [README.md → Quickstart](../README.md#quickstart)).
2. Restart your MCP client.
3. Ask Claude something that touches Calendar.app — `"What's on my calendar this week?"` is the canonical first prompt.
4. macOS pops a dialog: **"Terminal/iTerm/Code/… wants access to control Calendar.app."** Click **OK**.
5. (Sometimes a second dialog) **"…wants to access your calendars."** Click **OK**.
6. Re-run the prompt. The first run is sometimes lost in the permission dance.

## If you said "Don't Allow"

Open **System Settings → Privacy & Security → Automation**, find your terminal/IDE in the list, and toggle the **Calendar** switch underneath it. If your app isn't in the list at all, the permission was never requested — usually because the spawn chain is misidentified. Quit the app fully (`Cmd-Q`, not just close the window) and relaunch.

## Common errors

| Error                                               | What it means                                                                     | Fix                                                     |
| --------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `osascript: errors -1743`                           | "Not authorized to send Apple Events."                                            | Grant **Automation → Calendar** to the controlling app. |
| `osascript: errors -1744`                           | User declined the auth prompt.                                                    | Same — re-grant in System Settings.                     |
| `Calendar got an error: Application isn't running.` | Calendar.app hasn't been opened on this account.                                  | Open Calendar.app once, sign in, then retry.            |
| `Calendar got an error: Connection is invalid.`     | TCC reset, or controlling app was code-signed and re-signed (e.g. an IDE update). | Toggle the Automation permission off and back on.       |

## Recovery: full reset

If the TCC database has gotten weird (rare, but possible after macOS upgrades), revoke and re-grant:

```bash
# Revoke for one app — replace bundle id as appropriate.
tccutil reset AppleEvents com.apple.Terminal
```

Then re-run any HECKLE tool to re-trigger the prompt.

## Why HECKLE asks for so little

Local-only by construction. No network, no disk access outside `~/.apple-calendar-mcp/`. The Calendar.app TCC grant is the entire trust footprint — and it's Calendar.app that talks to iCloud, not HECKLE.
