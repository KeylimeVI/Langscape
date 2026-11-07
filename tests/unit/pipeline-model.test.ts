import { describe, expect, it } from "vitest";
import {
  errorsOnly,
  extractStepBlocks,
  parseCanvasPipeline,
  stepConfigFromObject,
  topologicalOrder,
  validatePipeline,
} from "../../src/pipeline/model";

function canvas(nodes: any[], edges: any[] = []): string {
  return JSON.stringify({ nodes, edges });
}

function textNode(id: string, text: string): any {
  return { id, type: "text", text, x: 0, y: 0, width: 300, height: 200 };
}

function block(config: string): string {
  return "```langscape\n" + config + "```";
}

const source = textNode("source", block("type: source\npath: Words/Proto\n"));
const change = textNode("change", block("type: sound-change\nfile: Changes/Demo.lsc\n"));
const output = textNode("output", block("type: output\npath: Words/Modern\n"));

describe("canvas pipeline parser", () => {
  it("extracts a source → sound change → output graph", () => {
    const graph = parseCanvasPipeline(
      canvas(
        [source, change, output],
        [
          { fromNode: "source", toNode: "change" },
          { fromNode: "change", toNode: "output" },
        ]
      ),
      "Pipelines/Demo.canvas"
    );
    expect(graph.steps.map((step) => step.kind)).toEqual([
      "source",
      "sound-change",
      "output",
    ]);
    expect(graph.edges).toEqual([
      { from: "source", to: "change" },
      { from: "change", to: "output" },
    ]);
    expect(errorsOnly(graph.issues)).toEqual([]);
    expect(topologicalOrder(graph).map((step) => step.id)).toEqual([
      "source",
      "change",
      "output",
    ]);
    expect(graph.steps[0]).toMatchObject({
      kind: "source",
      path: "Words/Proto",
      format: "markdown",
      field: "word",
    });
    expect(graph.steps[1]).toMatchObject({ kind: "sound-change", file: "Changes/Demo.lsc" });
    expect(graph.steps[2]).toMatchObject({
      kind: "output",
      path: "Words/Modern",
      format: "markdown",
      overwrite: true,
    });
  });

  it("ignores non-pipeline canvas nodes and warns about mixed edges", () => {
    const graph = parseCanvasPipeline(
      canvas(
        [
          source,
          change,
          output,
          { id: "note", type: "text", text: "Just a note" },
          { id: "file", type: "file", file: "Words/Proto/apa.md" },
        ],
        [
          { fromNode: "source", toNode: "change" },
          { fromNode: "change", toNode: "output" },
          { fromNode: "note", toNode: "change" },
        ]
      ),
      "Pipelines/Demo.canvas"
    );
    expect(graph.steps).toHaveLength(3);
    expect(graph.issues.some((issue) => issue.message.includes("non-pipeline"))).toBe(true);
    expect(errorsOnly(graph.issues)).toEqual([]);
  });

  it("reads inline words and word-list outputs", () => {
    const graph = parseCanvasPipeline(
      canvas(
        [
          textNode("words", block("type: words\nwords:\n  - apa\n  - eke\n")),
          textNode("out", block("type: output\npath: Build/words.wli\n")),
        ],
        [{ fromNode: "words", toNode: "out" }]
      ),
      "Pipelines/List.canvas"
    );
    expect(graph.steps[0]).toMatchObject({ kind: "words", words: ["apa", "eke"] });
    expect(graph.steps[1]).toMatchObject({ kind: "output", format: "wli" });
    expect(errorsOnly(graph.issues)).toEqual([]);
  });

  it("reports cycles", () => {
    const graph = parseCanvasPipeline(
      canvas(
        [source, change, output],
        [
          { fromNode: "source", toNode: "change" },
          { fromNode: "change", toNode: "output" },
          { fromNode: "output", toNode: "change" },
        ]
      ),
      "Pipelines/Cycle.canvas"
    );
    expect(validatePipeline(graph).some((issue) => issue.message.includes("cycle"))).toBe(true);
    expect(() => topologicalOrder(graph)).toThrow(/cycle/i);
  });

  it("requires sources and outputs", () => {
    const graph = parseCanvasPipeline(
      canvas([change, output], [{ fromNode: "change", toNode: "output" }]),
      "Pipelines/Broken.canvas"
    );
    const errors = errorsOnly(graph.issues);
    expect(errors.some((issue) => issue.message.includes("no source"))).toBe(true);
    expect(errors.some((issue) => issue.message.includes("no input"))).toBe(true);
  });

  it("rejects writing output inside its source folder", () => {
    const graph = parseCanvasPipeline(
      canvas(
        [source, change, textNode("output", block("type: output\npath: Words/Proto/Modern\n"))],
        [
          { fromNode: "source", toNode: "change" },
          { fromNode: "change", toNode: "output" },
        ]
      ),
      "Pipelines/Loop.canvas"
    );
    expect(
      errorsOnly(graph.issues).some((issue) => issue.message.includes("inside its source folder"))
    ).toBe(true);
  });

  it("supports aliases and inline changes", () => {
    const parsed = stepConfigFromObject(
      { type: "lexurgy", changes: "Symbol a\n\nRule:\n a => b", label: "Inline" },
      "n1"
    );
    expect(parsed.step).toMatchObject({
      kind: "sound-change",
      changes: "Symbol a\n\nRule:\n a => b",
      label: "Inline",
    });
    expect(parsed.issues).toEqual([]);
  });

  it("reports unknown types", () => {
    const parsed = stepConfigFromObject({ type: "wormhole" }, "n1");
    expect(parsed.step).toBeUndefined();
    expect(parsed.issues[0].message).toContain("Unknown pipeline step type");
  });

  it("extracts blocks with surrounding markdown", () => {
    const blocks = extractStepBlocks(
      ["## My source", "", block("type: source\npath: Words/Proto"), "", "Notes"].join("\n")
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].config).toEqual({ type: "source", path: "Words/Proto" });
  });
});
