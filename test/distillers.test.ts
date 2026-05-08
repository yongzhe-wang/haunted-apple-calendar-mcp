import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUILT_IN_DISTILLERS,
  getDistillerByName,
  loadCustomDistillers,
  mergeDistillerPools,
  SYNTHETIC_VOICE_ATTRIBUTION,
  type Distiller,
} from "../src/distillers.js";

describe("BUILT_IN_DISTILLERS", () => {
  it("has at least 10 distillers", () => {
    expect(BUILT_IN_DISTILLERS.length).toBeGreaterThanOrEqual(10);
  });

  it("every distiller has a unique name and short_label", () => {
    const names = BUILT_IN_DISTILLERS.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
    const labels = BUILT_IN_DISTILLERS.map((d) => d.short_label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("every short_label is non-empty and ≤16 chars", () => {
    for (const d of BUILT_IN_DISTILLERS) {
      expect(d.short_label.length).toBeGreaterThan(0);
      expect(d.short_label.length).toBeLessThanOrEqual(16);
    }
  });

  it("every directive is non-empty and ≤400 chars", () => {
    for (const d of BUILT_IN_DISTILLERS) {
      expect(d.directive.length, `${d.name}`).toBeGreaterThan(20);
      expect(d.directive.length, `${d.name}`).toBeLessThanOrEqual(400);
    }
  });

  it("every directive includes a Variation clause", () => {
    for (const d of BUILT_IN_DISTILLERS) {
      expect(d.directive, `${d.name} missing Variation clause`).toMatch(/Variation:/i);
    }
  });

  it("every directive includes an anti-fabrication clause", () => {
    for (const d of BUILT_IN_DISTILLERS) {
      expect(d.directive, `${d.name} missing anti-fabrication clause`).toMatch(
        /Anti-fabrication|never invent/i,
      );
    }
  });

  it("every directive references memory_context", () => {
    for (const d of BUILT_IN_DISTILLERS) {
      expect(d.directive, `${d.name} missing memory reference`).toMatch(/memory_context|memory/i);
    }
  });

  it("every directive includes a synthetic-voice disclaimer", () => {
    for (const d of BUILT_IN_DISTILLERS) {
      expect(d.directive, `${d.name} missing synthetic disclaimer`).toMatch(
        /synthetic|not endorsed/i,
      );
    }
  });

  it("every distiller has the verbatim attribution string", () => {
    for (const d of BUILT_IN_DISTILLERS) {
      expect(d.attribution).toBe(SYNTHETIC_VOICE_ATTRIBUTION);
    }
  });

  it("every distiller has at least 3 signature_phrases", () => {
    for (const d of BUILT_IN_DISTILLERS) {
      expect(d.signature_phrases.length, `${d.name}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("every distiller has at least one worldview_tag", () => {
    for (const d of BUILT_IN_DISTILLERS) {
      expect(d.worldview_tags.length, `${d.name}`).toBeGreaterThan(0);
    }
  });

  it("getDistillerByName roundtrips", () => {
    expect(getDistillerByName("Naval Ravikant")?.short_label).toBe("Naval");
    expect(getDistillerByName("not-a-real-distiller")).toBeUndefined();
  });
});

describe("loadCustomDistillers", () => {
  function tmpFile(contents: string): string {
    const dir = mkdtempSync(join(tmpdir(), "apple-cal-mcp-distillers-"));
    const p = join(dir, "distillers.json");
    writeFileSync(p, contents, "utf8");
    return p;
  }

  it("returns [] when the file does not exist", () => {
    expect(loadCustomDistillers(join(tmpdir(), "definitely-no-distillers-xyz.json"))).toEqual([]);
  });

  it("returns [] for an empty file", () => {
    expect(loadCustomDistillers(tmpFile(""))).toEqual([]);
  });

  it("returns [] for malformed JSON", () => {
    expect(loadCustomDistillers(tmpFile("{not json"))).toEqual([]);
  });

  it("returns [] for wrong shape (no version)", () => {
    expect(loadCustomDistillers(tmpFile(JSON.stringify({ distillers: [] })))).toEqual([]);
  });

  it("loads valid custom distillers", () => {
    const p = tmpFile(
      JSON.stringify({
        version: 1,
        distillers: [
          {
            name: "Custom",
            short_label: "Custom",
            directive:
              "Variation: rotate openers. Reference one memory_context item. Synthetic voice; not endorsed.",
            attribution: "Synthetic voice. Not endorsed.",
            signature_phrases: ["a", "b", "c"],
            worldview_tags: ["custom"],
          },
        ],
      }),
    );
    const out = loadCustomDistillers(p);
    expect(out).toHaveLength(1);
    expect(out[0]?.name).toBe("Custom");
  });

  it("drops entries missing required distiller fields", () => {
    const p = tmpFile(
      JSON.stringify({
        version: 1,
        distillers: [
          {
            name: "OK",
            short_label: "OK",
            directive: "Variation. memory_context. Synthetic; not endorsed.",
            attribution: "Synthetic.",
            signature_phrases: ["a"],
            worldview_tags: ["x"],
          },
          // missing attribution
          {
            name: "Bad",
            short_label: "Bad",
            directive: "x",
            signature_phrases: [],
            worldview_tags: [],
          },
        ],
      }),
    );
    const out = loadCustomDistillers(p);
    expect(out).toHaveLength(1);
    expect(out[0]?.name).toBe("OK");
  });
});

describe("mergeDistillerPools", () => {
  const sample = (name: string, label: string): Distiller => ({
    name,
    short_label: label,
    directive: "x",
    attribution: "y",
    signature_phrases: [],
    worldview_tags: [],
  });

  it("inline overrides persistent overrides built-in by name", () => {
    const out = mergeDistillerPools([sample("X", "B")], [sample("X", "P")], [sample("X", "I")]);
    expect(out).toHaveLength(1);
    expect(out[0]?.short_label).toBe("I");
  });

  it("unions distinct names", () => {
    const out = mergeDistillerPools([sample("A", "A")], [sample("B", "B")], [sample("C", "C")]);
    expect(out.map((d) => d.name).toSorted()).toEqual(["A", "B", "C"]);
  });
});
