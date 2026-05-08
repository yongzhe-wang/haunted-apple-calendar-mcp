import { describe, expect, it } from "vitest";
import {
  ExtractEntitiesFromInputInput,
  extractEntitiesFromInput,
} from "../src/tools/extract-entities-from-input.js";

describe("ExtractEntitiesFromInputInput schema", () => {
  it("accepts a minimal valid input", () => {
    const out = ExtractEntitiesFromInputInput.parse({ input_description: "lunch with leo" });
    expect(out.input_description).toBe("lunch with leo");
    expect(out.intent_hint).toBeUndefined();
  });

  it("rejects empty input_description", () => {
    expect(() => ExtractEntitiesFromInputInput.parse({ input_description: "" })).toThrow();
  });

  it("rejects oversize input_description (>8000)", () => {
    const big = "x".repeat(8001);
    expect(() => ExtractEntitiesFromInputInput.parse({ input_description: big })).toThrow();
  });

  it("rejects unknown intent_hint", () => {
    expect(() =>
      ExtractEntitiesFromInputInput.parse({
        input_description: "x",
        intent_hint: "vacation",
      }),
    ).toThrow();
  });

  it("accepts every documented intent_hint value", () => {
    for (const hint of [
      "add_to_calendar",
      "move_event",
      "cancel",
      "query",
      "analyze",
      "enrich_only",
      "unknown",
    ] as const) {
      expect(() =>
        ExtractEntitiesFromInputInput.parse({ input_description: "x", intent_hint: hint }),
      ).not.toThrow();
    }
  });
});

describe("extractEntitiesFromInput", () => {
  it("returns the documented schema + instructions + example", async () => {
    const out = await extractEntitiesFromInput({ input_description: "anything" });
    expect(out.extraction_schema.events.description).toBeTruthy();
    expect(out.extraction_schema.people.description).toBeTruthy();
    expect(out.extraction_schema.topics.description).toBeTruthy();
    expect(out.extraction_schema.user_statements.description).toBeTruthy();
    expect(out.extraction_schema.intent.description).toContain("add_to_calendar");
    expect(out.extraction_instructions).toContain("research_entities");
    expect(out.extraction_instructions).toContain("update_memory_from_input");
    expect(typeof out.example_output).toBe("object");
    expect(Array.isArray((out.example_output as { events?: unknown[] }).events)).toBe(true);
  });
});
