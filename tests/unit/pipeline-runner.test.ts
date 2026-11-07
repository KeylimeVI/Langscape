import { describe, expect, it, vi } from "vitest";
import { parseCanvasPipeline } from "../../src/pipeline/model";
import { runPipeline, graphSummary } from "../../src/pipeline/runner";

function canvas(nodes: any[], edges: any[] = []): string {
  return JSON.stringify({ nodes, edges });
}
function block(text: string): string {
  return "```langscape\n" + text + "```";
}
function node(id: string, config: string): any {
  return { id, type: "text", text: block(config) };
}

describe("pipeline runner", () => {
  it("runs a chain and records each stage", async () => {
    const graph = parseCanvasPipeline(
      canvas(
        [
          node("s", "type: source\npath: Words/Proto"),
          node("sc1", "type: sound-change\nfile: Changes/A.lsc\nlabel: Lenition"),
          node("sc2", "type: sound-change\nfile: Changes/B.lsc\nlabel: Raising"),
          node("out", "type: output\npath: Words/Modern"),
        ],
        [
          { fromNode: "s", toNode: "sc1" },
          { fromNode: "sc1", toNode: "sc2" },
          { fromNode: "sc2", toNode: "out" },
        ]
      ),
      "P.canvas"
    );

    const write = vi.fn(async () => ({ paths: ["Words/Modern/aab.md"], skipped: [], errors: [] }));
    const apply = vi.fn(async (changes: string, words: string[]) => ({
      words: words.map((word) => word + (changes.includes("A") ? "a" : "b")),
      intermediates: {},
      traceLines: [],
    }));

    const report = await runPipeline(graph, {
      extractSource: async () => [
        { word: "x", sourcePath: "Words/Proto/x.md", meta: {} },
        { word: "y", sourcePath: "Words/Proto/y.md", meta: {} },
      ],
      readFile: async (path) => (path.includes("A") ? "A" : "B"),
      apply,
      writeOutput: write,
      onProgress: () => {},
    });

    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply.mock.calls[0][1]).toEqual(["x", "y"]);
    expect(apply.mock.calls[1][1]).toEqual(["xa", "ya"]);
    expect(write).toHaveBeenCalledTimes(1);
    const [step, words, changes] = write.mock.calls[0] as any[];
    expect(step).toMatchObject({ kind: "output", path: "Words/Modern" });
    expect(words.map((word: any) => word.form)).toEqual(["xab", "yab"]);
    expect(words[0].history.map((stage: any) => stage.label)).toEqual(["Lenition", "Raising"]);
    expect(changes).toEqual(["Changes/A.lsc", "Changes/B.lsc"]);
    expect(report.stepsRun).toBe(4);
    expect(report.wordsIn).toBe(2);
    expect(report.wordsOut).toBe(2);
    expect(report.outputs[0].paths).toEqual(["Words/Modern/aab.md"]);
    expect(graphSummary(graph)).toContain("1 source");
  });

  it("merges multiple sources into one sound change", async () => {
    const graph = parseCanvasPipeline(
      canvas(
        [
          node("s1", "type: source\npath: Words/A"),
          node("s2", "type: words\nwords: [kata, eke]"),
          node("sc", "type: sound-change\nfile: C.lsc"),
          node("out", "type: output\npath: Words/Out"),
        ],
        [
          { fromNode: "s1", toNode: "sc" },
          { fromNode: "s2", toNode: "sc" },
          { fromNode: "sc", toNode: "out" },
        ]
      ),
      "P.canvas"
    );
    const apply = vi.fn(async (_changes: string, words: string[]) => ({
      words,
      intermediates: {},
      traceLines: [],
    }));
    const write = vi.fn(async () => ({ paths: [], skipped: [], errors: [] }));
    await runPipeline(graph, {
      extractSource: async () => [{ word: "apa", meta: {} }],
      readFile: async () => "C",
      apply,
      writeOutput: write,
    });
    expect(apply.mock.calls[0][1]).toEqual(["apa", "kata", "eke"]);
  });

  it("fails clearly when a source is empty", async () => {
    const graph = parseCanvasPipeline(
      canvas(
        [node("s", "type: source\npath: Empty"), node("o", "type: output\npath: Out")],
        [{ fromNode: "s", toNode: "o" }]
      ),
      "P.canvas"
    );
    await expect(
      runPipeline(graph, {
        extractSource: async () => [],
        readFile: async () => "",
        apply: async () => ({ words: [], intermediates: {}, traceLines: [] }),
        writeOutput: async () => ({ paths: [], skipped: [], errors: [] }),
      })
    ).rejects.toThrow(/produced no words/);
  });

  it("refuses to run an invalid graph", async () => {
    const graph = parseCanvasPipeline(
      canvas([node("o", "type: output\npath: Out")], []),
      "P.canvas"
    );
    await expect(
      runPipeline(graph, {
        extractSource: async () => [],
        readFile: async () => "",
        apply: async () => ({ words: [], intermediates: {}, traceLines: [] }),
        writeOutput: async () => ({ paths: [], skipped: [], errors: [] }),
      })
    ).rejects.toMatchObject({ name: "PipelineError" });
  });

  it("reports write errors as step failures", async () => {
    const graph = parseCanvasPipeline(
      canvas(
        [node("s", "type: source\npath: S"), node("o", "type: output\npath: Out")],
        [{ fromNode: "s", toNode: "o" }]
      ),
      "P.canvas"
    );
    await expect(
      runPipeline(graph, {
        extractSource: async () => [{ word: "x", meta: {} }],
        readFile: async () => "",
        apply: async () => ({ words: [], intermediates: {}, traceLines: [] }),
        writeOutput: async () => ({ paths: [], skipped: [], errors: ["disk full"] }),
      })
    ).rejects.toThrow(/disk full/);
  });
});

describe("pipeline branch runs", () => {
  it("runs only the selected output's ancestors", async () => {
    const graph = parseCanvasPipeline(
      canvas(
        [
          node("s", "type: source\npath: S"),
          node("sc", "type: sound-change\nfile: C.lsc"),
          node("out1", "type: output\npath: Out1"),
          node("out2", "type: output\npath: Out2"),
        ],
        [
          { fromNode: "s", toNode: "sc" },
          { fromNode: "sc", toNode: "out1" },
          { fromNode: "sc", toNode: "out2" },
        ]
      ),
      "P.canvas"
    );
    const write = vi.fn(async (step: any) => ({
      paths: [`${step.path}/x.md`],
      skipped: [],
      errors: [],
    }));
    const apply = vi.fn(async (_changes: string, words: string[]) => ({
      words,
      intermediates: {},
      traceLines: [],
    }));
    const report = await runPipeline(
      graph,
      {
        extractSource: async () => [{ word: "x", meta: {} }],
        readFile: async () => "C",
        apply,
        writeOutput: write,
      },
      { targetOutputId: "out2" }
    );
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0]).toMatchObject({ id: "out2" });
    expect(report.outputs).toHaveLength(1);
    expect(report.outputs[0].paths).toEqual(["Out2/x.md"]);
  });

  it("rejects a missing target output", async () => {
    const graph = parseCanvasPipeline(
      canvas(
        [node("s", "type: source\npath: S"), node("o", "type: output\npath: O")],
        [{ fromNode: "s", toNode: "o" }]
      ),
      "P.canvas"
    );
    await expect(
      runPipeline(
        graph,
        {
          extractSource: async () => [],
          readFile: async () => "",
          apply: async () => ({ words: [], intermediates: {}, traceLines: [] }),
          writeOutput: async () => ({ paths: [], skipped: [], errors: [] }),
        },
        { targetOutputId: "missing" }
      )
    ).rejects.toThrow(/No output/);
  });
});
