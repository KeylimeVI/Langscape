import type { LexurgyApplyResult } from "../lexurgy/server";
import {
  PipelineError,
  errorsOnly,
  predecessors,
  topologicalOrder,
  validatePipeline,
  type PipelineGraph,
  type PipelineStep,
  type SourceStep,
  type SoundChangeStep,
  type WordsStep,
  type OutputStep,
  type PipelineIssue,
} from "./model";
import type { OutputWord, Stage } from "./output";
import type { WordEntry } from "./words";
import type { WriteOutputResult } from "./writer";

export interface PipelineWorkWord extends WordEntry {
  form: string;
  history: Stage[];
}

export interface PipelineDependencies {
  extractSource: (step: SourceStep) => Promise<WordEntry[]>;
  readFile: (path: string) => Promise<string>;
  apply: (
    changes: string,
    words: string[],
    options: { startAt?: string; stopBefore?: string }
  ) => Promise<LexurgyApplyResult>;
  writeOutput: (
    step: OutputStep,
    words: OutputWord[],
    changes: string[]
  ) => Promise<WriteOutputResult>;
  onProgress?: (message: string) => void;
}

export interface PipelineRunReport {
  canvasPath: string;
  stepsRun: number;
  wordsIn: number;
  wordsOut: number;
  outputs: Array<{ stepId: string; label: string } & WriteOutputResult>;
  durationMs: number;
  issues: PipelineIssue[];
}

export interface PipelineRunOptions {
  /** Run only the output node and the steps it depends on. */
  targetOutputId?: string;
}

export async function runPipeline(
  graph: PipelineGraph,
  deps: PipelineDependencies,
  options: PipelineRunOptions = {}
): Promise<PipelineRunReport> {
  const runGraph = options.targetOutputId
    ? branchGraph(graph, options.targetOutputId)
    : graph;
  const issues = validatePipeline(runGraph);
  const errors = errorsOnly(issues);
  if (errors.length > 0) {
    throw new PipelineError(
      `The pipeline has ${errors.length} problem${errors.length === 1 ? "" : "s"}.`,
      issues
    );
  }

  const started = Date.now();
  const order = topologicalOrder(runGraph);
  const values = new Map<string, PipelineWorkWord[]>();
  const outputs: PipelineRunReport["outputs"] = [];
  let wordsIn = 0;
  let stepsRun = 0;
  const changePaths = collectChangePaths(order);

  for (const step of order) {
    deps.onProgress?.(`Running ${step.label}…`);
    stepsRun++;
    try {
      if (step.kind === "source") {
        const entries = await deps.extractSource(step);
        if (entries.length === 0) {
          throw new Error(
            `The source "${step.path}" produced no words. Check the folder and the “${step.field}” frontmatter field.`
          );
        }
        wordsIn = Math.max(wordsIn, entries.length);
        values.set(
          step.id,
          entries.map((entry) => ({ ...entry, form: entry.word, history: [] }))
        );
      } else if (step.kind === "words") {
        values.set(
          step.id,
          step.words
            .map((word) => word.trim())
            .filter(Boolean)
            .map((word) => ({ word, form: word, history: [], meta: {} }))
        );
        wordsIn = Math.max(wordsIn, values.get(step.id)?.length ?? 0);
      } else if (step.kind === "sound-change") {
        const input = collectInputs(runGraph, values, step);
        const changes = await loadChanges(step, deps);
        const result = await deps.apply(
          changes,
          input.map((word) => word.form),
          { startAt: step.startAt, stopBefore: step.stopBefore }
        );
        if (result.words.length !== input.length) {
          throw new Error(
            `Lexurgy returned ${result.words.length} words for ${input.length} inputs in "${step.label}".`
          );
        }
        const next = input.map((word, index) => {
          const form = result.words[index];
          return {
            ...word,
            form,
            history: [...word.history, { label: step.label, form }],
          };
        });
        values.set(step.id, next);
      } else if (step.kind === "output") {
        const input = collectInputs(runGraph, values, step);
        const outputWords: OutputWord[] = input.map((word) => ({
          word: word.word,
          form: word.form,
          sourcePath: word.sourcePath,
          meta: word.meta,
          history: word.history,
        }));
        const result = await deps.writeOutput(step, outputWords, changePaths);
        values.set(step.id, input);
        outputs.push({ stepId: step.id, label: step.label, ...result });
        if (result.errors.length > 0) {
          throw new Error(result.errors.join(" "));
        }
      }
    } catch (error) {
      if (error instanceof PipelineError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new PipelineError(`Step "${step.label}" failed: ${message}`, [
        { severity: "error", stepId: step.id, message },
        ...issues.filter((issue) => issue.severity === "warning"),
      ]);
    }
  }

  const finalOutputs = [...values.entries()].filter(([id]) => {
    const step = runGraph.steps.find((candidate) => candidate.id === id);
    return step?.kind === "output";
  });
  const wordsOut = finalOutputs.reduce((sum, [, words]) => sum + words.length, 0);

  return {
    canvasPath: runGraph.canvasPath,
    stepsRun,
    wordsIn,
    wordsOut: wordsOut || outputs.reduce((sum, output) => sum + output.paths.length, 0),
    outputs,
    durationMs: Date.now() - started,
    issues,
  };
}

export function branchGraph(graph: PipelineGraph, targetOutputId: string): PipelineGraph {
  const target = graph.steps.find(
    (step) => step.id === targetOutputId && step.kind === "output"
  );
  if (!target) {
    throw new PipelineError(`No output step with id "${targetOutputId}".`);
  }
  const included = new Set<string>([target.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of graph.edges) {
      if (included.has(edge.to) && !included.has(edge.from)) {
        included.add(edge.from);
        changed = true;
      }
    }
  }
  return {
    ...graph,
    steps: graph.steps.filter((step) => included.has(step.id)),
    edges: graph.edges.filter((edge) => included.has(edge.from) && included.has(edge.to)),
    issues: graph.issues.filter((issue) => !issue.stepId || included.has(issue.stepId)),
  };
}

export function collectInputs(
  graph: PipelineGraph,
  values: Map<string, PipelineWorkWord[]>,
  step: PipelineStep
): PipelineWorkWord[] {
  const inputSteps = predecessors(graph, step.id);
  if (inputSteps.length === 0) return [];
  const result: PipelineWorkWord[] = [];
  for (const id of inputSteps) {
    result.push(...(values.get(id) ?? []));
  }
  return result;
}

export async function loadChanges(
  step: SoundChangeStep,
  deps: Pick<PipelineDependencies, "readFile">
): Promise<string> {
  if (step.changes?.trim()) return step.changes;
  if (!step.file) throw new Error("This sound-change step has no file.");
  const changes = await deps.readFile(step.file);
  if (!changes.trim()) throw new Error(`The sound-change file "${step.file}" is empty.`);
  return changes;
}

export function collectChangePaths(order: PipelineStep[]): string[] {
  return order
    .filter((step): step is SoundChangeStep => step.kind === "sound-change")
    .map((step) => step.file ?? step.label)
    .filter((value) => Boolean(value));
}

export function graphSummary(graph: PipelineGraph): string {
  const counts = new Map<string, number>();
  for (const step of graph.steps) {
    counts.set(step.kind, (counts.get(step.kind) ?? 0) + 1);
  }
  const parts: string[] = [];
  if (counts.get("source")) parts.push(`${counts.get("source")} source`);
  if (counts.get("words")) parts.push(`${counts.get("words")} word list`);
  if (counts.get("sound-change")) parts.push(`${counts.get("sound-change")} sound change`);
  if (counts.get("output")) parts.push(`${counts.get("output")} output`);
  return parts.join(" · ") || "Empty pipeline";
}

export type { SourceStep, SoundChangeStep, WordsStep, OutputStep };
