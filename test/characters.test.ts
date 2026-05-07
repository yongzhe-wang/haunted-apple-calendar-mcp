import { describe, expect, it } from "vitest";
import { BUILT_IN_CHARACTERS, getCharacterByName } from "../src/characters.js";

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
