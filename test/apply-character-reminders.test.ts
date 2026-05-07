import { describe, expect, it } from "vitest";
import {
  BACKUP_BLOCK_CLOSE,
  BACKUP_BLOCK_OPEN,
  buildBackupBlock,
  extractBackup,
  notesWithBackup,
  notesWithoutBackup,
} from "../src/tools/apply-character-reminders.js";
import { ApplyCharacterRemindersInput } from "../src/types.js";

describe("ApplyCharacterRemindersInput", () => {
  it("requires at least one item", () => {
    expect(() => ApplyCharacterRemindersInput.parse({ events_with_reminders: [] })).toThrow();
  });

  it("rejects more than 200 items", () => {
    expect(() =>
      ApplyCharacterRemindersInput.parse({
        events_with_reminders: Array.from({ length: 201 }, (_, i) => ({
          uid: `u-${i}`,
          calendar: "Work",
          new_title: "x",
        })),
      }),
    ).toThrow();
  });

  it("defaults dry_run to false", () => {
    const out = ApplyCharacterRemindersInput.parse({
      events_with_reminders: [{ uid: "u", calendar: "Work", new_title: "x" }],
    });
    expect(out.dry_run).toBe(false);
  });

  it("requires non-empty new_title", () => {
    expect(() =>
      ApplyCharacterRemindersInput.parse({
        events_with_reminders: [{ uid: "u", calendar: "Work", new_title: "" }],
      }),
    ).toThrow();
  });
});

describe("backup block helpers", () => {
  const payload = {
    title: "Original Title",
    notes: "original notes",
    location: "Room 101",
    applied_at: "2026-04-01T00:00:00Z",
  };

  it("buildBackupBlock contains both sentinels", () => {
    const block = buildBackupBlock(payload);
    expect(block).toContain(BACKUP_BLOCK_OPEN);
    expect(block).toContain(BACKUP_BLOCK_CLOSE);
  });

  it("notesWithBackup roundtrips through extractBackup", () => {
    const wrapped = notesWithBackup("user notes here", payload);
    const got = extractBackup(wrapped);
    expect(got?.title).toBe(payload.title);
    expect(got?.notes).toBe(payload.notes);
    expect(got?.location).toBe(payload.location);
  });

  it("notesWithBackup does not double-wrap when backup already present", () => {
    const wrapped = notesWithBackup(undefined, payload);
    const reapplied = notesWithBackup(wrapped, {
      ...payload,
      title: "shouldn't replace",
    });
    expect(reapplied).toBe(wrapped);
  });

  it("notesWithoutBackup strips the backup block", () => {
    const wrapped = notesWithBackup("hello", payload);
    const stripped = notesWithoutBackup(wrapped);
    expect(stripped).toBe("hello");
  });

  it("notesWithoutBackup returns undefined when only the backup remained", () => {
    const wrapped = notesWithBackup(undefined, payload);
    const stripped = notesWithoutBackup(wrapped);
    expect(stripped).toBeUndefined();
  });

  it("extractBackup returns undefined when block missing", () => {
    expect(extractBackup("plain notes")).toBeUndefined();
    expect(extractBackup(undefined)).toBeUndefined();
  });

  it("extractBackup returns undefined when JSON inside is broken", () => {
    const bad = `pre\n${BACKUP_BLOCK_OPEN}\n{not json\n${BACKUP_BLOCK_CLOSE}\n`;
    expect(extractBackup(bad)).toBeUndefined();
  });
});
