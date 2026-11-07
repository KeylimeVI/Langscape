import { describe, expect, it } from "vitest";
import { updatePipelineBlock } from "../../src/pipeline/block-edit";

const source = [
  "Some prose",
  "",
  "```langscape",
  "type: output",
  "path: Words/Modern",
  "field: word",
  "```",
  "",
  "More prose",
].join("\n");

describe("updatePipelineBlock", () => {
  it("updates an existing key without touching other prose", () => {
    const updated = updatePipelineBlock(source, { field: "lexeme" });
    expect(updated).toContain("field: lexeme");
    expect(updated).not.toContain("field: word");
    expect(updated).toContain("path: Words/Modern");
    expect(updated.startsWith("Some prose")).toBe(true);
    expect(updated.endsWith("More prose")).toBe(true);
  });

  it("adds and removes keys", () => {
    const withName = updatePipelineBlock(source, { name: "Modern Language" });
    expect(withName).toContain('name: Modern Language');
    const removed = updatePipelineBlock(withName, { name: undefined, field: "" });
    expect(removed).not.toContain("name:");
    expect(removed).not.toContain("field:");
    expect(removed).toContain("type: output");
  });

  it("quotes values that could break YAML", () => {
    const updated = updatePipelineBlock(source, { name: 'A: "quoted" value' });
    expect(updated).toContain('name: "A: \\"quoted\\" value"');
  });

  it("leaves text without a langscape block alone", () => {
    expect(updatePipelineBlock("hello", { field: "x" })).toBe("hello");
  });
});
