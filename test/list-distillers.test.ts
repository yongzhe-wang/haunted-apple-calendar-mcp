import { describe, expect, it } from "vitest";
import { BUILT_IN_DISTILLERS, type Distiller } from "../src/distillers.js";
import { buildListDistillersResult } from "../src/tools/list-distillers.js";
import { ListDistillersInput, ListDistillersOutput } from "../src/types.js";

describe("ListDistillersInput", () => {
  it("applies use_persistent_config default of true", () => {
    expect(ListDistillersInput.parse({}).use_persistent_config).toBe(true);
  });

  it("accepts filter strings", () => {
    const out = ListDistillersInput.parse({
      worldview_filter: "founder",
      name_filter: "tan",
    });
    expect(out.worldview_filter).toBe("founder");
    expect(out.name_filter).toBe("tan");
  });
});

describe("buildListDistillersResult", () => {
  it("returns all built-ins by default", () => {
    const out = buildListDistillersResult({ use_persistent_config: false }, []);
    expect(out.total).toBe(BUILT_IN_DISTILLERS.length);
    expect(out.source).toBe("built-in");
    ListDistillersOutput.parse(out);
  });

  it("filters by name (substring, case-insensitive)", () => {
    const out = buildListDistillersResult(
      { use_persistent_config: false, name_filter: "naval" },
      [],
    );
    expect(out.total).toBeGreaterThan(0);
    for (const d of out.distillers) {
      expect(`${d.name} ${d.short_label}`.toLowerCase()).toContain("naval");
    }
  });

  it("filters by worldview tag (exact, case-insensitive)", () => {
    const out = buildListDistillersResult(
      { use_persistent_config: false, worldview_filter: "founder" },
      [],
    );
    expect(out.total).toBeGreaterThan(0);
    for (const d of out.distillers) {
      expect(d.worldview_tags.map((t) => t.toLowerCase())).toContain("founder");
    }
  });

  it("merges persistent into the pool", () => {
    const persistent: Distiller[] = [
      {
        name: "Custom-Yongzhe",
        short_label: "Yongzhe",
        directive:
          "Variation: rotate openers. Reference memory_context. Synthetic voice; not endorsed.",
        attribution: "Synthetic voice from supplied corpus. Not endorsed.",
        signature_phrases: ["ship it", "the punch is", "in 中文"],
        worldview_tags: ["founder", "self-distilled"],
      },
    ];
    const out = buildListDistillersResult({ use_persistent_config: true }, persistent);
    expect(out.distillers.find((d) => d.name === "Custom-Yongzhe")).toBeDefined();
    expect(out.source).toBe("merged");
  });

  it("notice mentions the synthetic-voice disclaimer", () => {
    const out = buildListDistillersResult({ use_persistent_config: false }, []);
    expect(out.notice.toLowerCase()).toMatch(/synthetic|not endorsed/);
  });

  it("every output entry carries an attribution", () => {
    const out = buildListDistillersResult({ use_persistent_config: false }, []);
    for (const d of out.distillers) {
      expect(d.attribution.length).toBeGreaterThan(0);
    }
  });
});
