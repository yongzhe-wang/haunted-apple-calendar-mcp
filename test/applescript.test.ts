import { describe, expect, it } from "vitest";
import {
  escapeAppleScriptString,
  isoToAppleScriptDate,
  parseRecords,
  RECORD_SEPARATOR,
  UNIT_SEPARATOR,
} from "../src/applescript.js";

describe("escapeAppleScriptString", () => {
  it("wraps simple strings in double quotes", () => {
    expect(escapeAppleScriptString("hello")).toBe('"hello"');
  });

  it("escapes embedded double quotes", () => {
    expect(escapeAppleScriptString('say "hi"')).toBe('"say \\"hi\\""');
  });

  it("escapes backslashes before quotes to prevent injection", () => {
    expect(escapeAppleScriptString("a\\b")).toBe('"a\\\\b"');
  });

  it("neutralizes AppleScript string-escape injection attempts", () => {
    // Attempt to close the string and run arbitrary commands.
    const malicious = '"; do shell script "rm -rf /"; --';
    const escaped = escapeAppleScriptString(malicious);
    expect(escaped).toBe('"\\"; do shell script \\"rm -rf /\\"; --"');
    // Every internal quote should be backslash-escaped.
    const inner = escaped.slice(1, -1);
    for (let i = 0; i < inner.length; i++) {
      if (inner[i] === '"') {
        expect(inner[i - 1]).toBe("\\");
      }
    }
  });

  it("handles empty strings", () => {
    expect(escapeAppleScriptString("")).toBe('""');
  });

  it("preserves unicode and escapes newlines without breaking quoting", () => {
    const input = "café\n中文";
    const escaped = escapeAppleScriptString(input);
    expect(escaped).toBe('"café\\n中文"');
  });

  it("escapes a bare line feed as backslash-n", () => {
    expect(escapeAppleScriptString("a\nb")).toBe('"a\\nb"');
  });

  it("escapes a bare carriage return as backslash-r", () => {
    expect(escapeAppleScriptString("a\rb")).toBe('"a\\rb"');
  });

  it("escapes Windows-style CRLF as backslash-r backslash-n", () => {
    expect(escapeAppleScriptString("a\r\nb")).toBe('"a\\r\\nb"');
  });

  it("escapes a mix of backslash, double-quote, and newline correctly", () => {
    // Order matters: \ first, then ", then \n. A naive impl that escapes
    // \n before \\ would emit `\\n` (escaped backslash + literal n) which
    // is not a newline escape sequence at all.
    const input = 'a\\b"c\nd';
    const escaped = escapeAppleScriptString(input);
    expect(escaped).toBe('"a\\\\b\\"c\\nd"');
  });
});

describe("isoToAppleScriptDate", () => {
  it("produces an AppleScript expression using local date components", () => {
    const iso = "1970-01-01T00:00:01Z";
    const local = new Date(iso);
    const out = isoToAppleScriptDate(iso);
    expect(out).toContain("set d to current date");
    expect(out).toContain(`set year of d to ${local.getFullYear()}`);
    expect(out).toContain(`set day of d to ${local.getDate()}`);
    expect(out).toContain(
      `set time of d to ${local.getHours() * 3600 + local.getMinutes() * 60 + local.getSeconds()}`,
    );
  });

  it("converts a UTC timestamp to local date parts", () => {
    const out = isoToAppleScriptDate("2026-01-01T00:00:00Z");
    expect(out).toContain("set year of d to 2025");
    expect(out).toContain("set month of d to December");
  });

  it("keeps local wall-clock time for ISO dates with timezone offsets", () => {
    const out = isoToAppleScriptDate("2026-04-21T10:30:00-07:00");
    expect(out).toContain("set year of d to 2026");
    expect(out).toContain("set month of d to April");
    expect(out).toContain("set day of d to 21");
    expect(out).toContain("set time of d to 48600");
  });

  it("throws on invalid ISO strings", () => {
    expect(() => isoToAppleScriptDate("not-a-date")).toThrow(/Invalid/);
  });
});

describe("parseRecords", () => {
  it("returns empty for empty string", () => {
    expect(parseRecords("")).toEqual([]);
  });

  it("splits on record and unit separators", () => {
    const raw = `a${UNIT_SEPARATOR}b${RECORD_SEPARATOR}c${UNIT_SEPARATOR}d${RECORD_SEPARATOR}`;
    expect(parseRecords(raw)).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("handles trailing record separator without creating empty rows", () => {
    const raw = `x${UNIT_SEPARATOR}y${RECORD_SEPARATOR}`;
    expect(parseRecords(raw)).toEqual([["x", "y"]]);
  });

  it("preserves empty fields", () => {
    const raw = `a${UNIT_SEPARATOR}${UNIT_SEPARATOR}c${RECORD_SEPARATOR}`;
    expect(parseRecords(raw)).toEqual([["a", "", "c"]]);
  });
});
