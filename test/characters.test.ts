import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUILT_IN_CHARACTERS,
  getCharacterByName,
  loadCustomCharacters,
  mergeCharacterPools,
} from "../src/characters.js";

describe("BUILT_IN_CHARACTERS", () => {
  it("has at least 10 characters", () => {
    expect(BUILT_IN_CHARACTERS.length).toBeGreaterThanOrEqual(10);
  });

  it("every character has a unique name and short_label", () => {
    const names = BUILT_IN_CHARACTERS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    const labels = BUILT_IN_CHARACTERS.map((c) => c.short_label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("every short_label is non-empty and ≤16 chars", () => {
    for (const c of BUILT_IN_CHARACTERS) {
      expect(c.short_label.length).toBeGreaterThan(0);
      expect(c.short_label.length).toBeLessThanOrEqual(16);
    }
  });

  it("every directive is non-empty and ≤300 chars", () => {
    for (const c of BUILT_IN_CHARACTERS) {
      expect(c.directive.length).toBeGreaterThan(20);
      expect(c.directive.length).toBeLessThanOrEqual(300);
    }
  });

  it("every directive references memory or shared history", () => {
    const memoryHint = /memory|reference|past|prior|last time|context|streak|pattern|item/i;
    for (const c of BUILT_IN_CHARACTERS) {
      expect(c.directive, `${c.name} missing memory hint`).toMatch(memoryHint);
    }
  });

  it("non-default characters have at least one trigger", () => {
    for (const c of BUILT_IN_CHARACTERS) {
      if (!c.default) {
        expect((c.triggers ?? []).length, `${c.name}`).toBeGreaterThan(0);
      }
    }
  });

  it("getCharacterByName roundtrips", () => {
    const first = BUILT_IN_CHARACTERS[0];
    expect(first).toBeDefined();
    if (first) {
      expect(getCharacterByName(first.name)?.name).toBe(first.name);
    }
    expect(getCharacterByName("not-a-real-character")).toBeUndefined();
  });
});

describe("loadCustomCharacters", () => {
  function tmpFile(contents: string): string {
    const dir = mkdtempSync(join(tmpdir(), "apple-cal-mcp-chars-"));
    const p = join(dir, "characters.json");
    writeFileSync(p, contents, "utf8");
    return p;
  }

  it("returns [] when the file does not exist", () => {
    expect(loadCustomCharacters(join(tmpdir(), "definitely-does-not-exist-xyz.json"))).toEqual([]);
  });

  it("returns [] for an empty file", () => {
    expect(loadCustomCharacters(tmpFile(""))).toEqual([]);
  });

  it("returns [] for malformed JSON", () => {
    expect(loadCustomCharacters(tmpFile("{not json"))).toEqual([]);
  });

  it("returns [] for wrong shape (no version)", () => {
    expect(loadCustomCharacters(tmpFile(JSON.stringify({ characters: [] })))).toEqual([]);
  });

  it("loads valid custom characters", () => {
    const p = tmpFile(
      JSON.stringify({
        version: 1,
        characters: [
          {
            name: "MyBoss",
            short_label: "Boss",
            directive: "Terse, slightly impatient. Reference one memory_context item.",
            triggers: ["meeting", "review"],
          },
        ],
      }),
    );
    const out = loadCustomCharacters(p);
    expect(out).toHaveLength(1);
    expect(out[0]?.name).toBe("MyBoss");
  });

  it("silently drops invalid entries but keeps valid ones", () => {
    const p = tmpFile(
      JSON.stringify({
        version: 1,
        characters: [
          { name: "OK", short_label: "OK", directive: "Reference a memory_context item." },
          { name: "BadShort", short_label: "way-too-long-label", directive: "x" },
          { name: "", short_label: "x", directive: "x" },
        ],
      }),
    );
    const out = loadCustomCharacters(p);
    expect(out).toHaveLength(1);
    expect(out[0]?.name).toBe("OK");
  });
});

describe("mergeCharacterPools", () => {
  it("inline overrides persistent overrides built-in by name", () => {
    const builtIn = [{ name: "X", short_label: "B", directive: "built-in" }];
    const persistent = [{ name: "X", short_label: "P", directive: "persistent" }];
    const inline = [{ name: "X", short_label: "I", directive: "inline" }];
    const out = mergeCharacterPools(builtIn, persistent, inline);
    expect(out).toHaveLength(1);
    expect(out[0]?.short_label).toBe("I");
  });

  it("unions distinct names", () => {
    const out = mergeCharacterPools(
      [{ name: "A", short_label: "A", directive: "a" }],
      [{ name: "B", short_label: "B", directive: "b" }],
      [{ name: "C", short_label: "C", directive: "c" }],
    );
    expect(out.map((c) => c.name).toSorted()).toEqual(["A", "B", "C"]);
  });
});
