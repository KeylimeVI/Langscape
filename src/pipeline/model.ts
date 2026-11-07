import { parseYaml } from "obsidian";

export type PipelineStepKind = "source" | "words" | "sound-change" | "output";

export interface PipelineStepBase {
  id: string;
  kind: PipelineStepKind;
  label: string;
  /** Original code block, used to correlate cards with graph steps. */
  raw?: string;
}

export interface SourceStep extends PipelineStepBase {
  kind: "source";
  path: string;
  format: "markdown" | "wli";
  field: string;
}

export interface WordsStep extends PipelineStepBase {
  kind: "words";
  words: string[];
}

export interface SoundChangeStep extends PipelineStepBase {
  kind: "sound-change";
  file?: string;
  changes?: string;
  startAt?: string;
  stopBefore?: string;
}

export interface OutputStep extends PipelineStepBase {
  kind: "output";
  path: string;
  format: "markdown" | "wli";
  /** Property name for the evolved word in generated notes. */
  field: string;
  /** Pipeline/language name written to generated notes; defaults to the output folder name. */
  name?: string;
  filename?: string;
  overwrite: boolean;
}

export type PipelineStep = SourceStep | WordsStep | SoundChangeStep | OutputStep;

export interface PipelineEdge {
  from: string;
  to: string;
}

export type IssueSeverity = "error" | "warning";

export interface PipelineIssue {
  severity: IssueSeverity;
  message: string;
  stepId?: string;
  line?: number;
}

export interface PipelineGraph {
  canvasPath: string;
  title: string;
  steps: PipelineStep[];
  edges: PipelineEdge[];
  issues: PipelineIssue[];
}

export class PipelineError extends Error {
  readonly issues: PipelineIssue[];

  constructor(message: string, issues: PipelineIssue[] = []) {
    super(message);
    this.name = "PipelineError";
    this.issues = issues;
  }
}

const CODE_BLOCK = /```langscape(?:[ \t]+[^\n]*)?\r?\n([\s\S]*?)```/gi;

export interface ParsedStepBlock {
  config: Record<string, unknown>;
  raw: string;
}

/** Extract every ```langscape block from a canvas text node / note. */
export function extractStepBlocks(text: string): ParsedStepBlock[] {
  const blocks: ParsedStepBlock[] = [];
  CODE_BLOCK.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CODE_BLOCK.exec(text)) !== null) {
    const raw = match[1].trim();
    if (!raw) continue;
    let config: unknown;
    try {
      config = parseYaml(raw);
    } catch {
      continue;
    }
    if (!config || typeof config !== "object" || Array.isArray(config)) continue;
    blocks.push({ config: config as Record<string, unknown>, raw });
  }
  return blocks;
}

/** Parse one code block's YAML into a step config without needing a graph. */
export function parseStepBlock(source: string): ParsedStepBlock | undefined {
  let config: unknown;
  try {
    config = parseYaml(source);
  } catch {
    return undefined;
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) return undefined;
  return { config: config as Record<string, unknown>, raw: source.trim() };
}

export interface CanvasNode {
  id?: string;
  type?: string;
  text?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  file?: string;
  label?: string;
}

export interface CanvasFile {
  nodes?: CanvasNode[];
  edges?: Array<{ fromNode?: string; toNode?: string; id?: string }>;
}

/**
 * Turn an Obsidian `.canvas` file into a pipeline. Canvas text nodes whose
 * markdown contains a ```langscape block are pipeline steps; canvas edges are
 * data-flow edges. Other canvas content is ignored.
 */
export function parseCanvasPipeline(
  canvasText: string,
  canvasPath: string
): PipelineGraph {
  let canvas: CanvasFile;
  try {
    canvas = JSON.parse(canvasText) as CanvasFile;
  } catch {
    throw new PipelineError(`"${canvasPath}" is not valid Canvas JSON.`, [
      { severity: "error", message: "Could not parse the .canvas file." },
    ]);
  }
  if (!canvas || !Array.isArray(canvas.nodes)) {
    throw new PipelineError(`"${canvasPath}" does not contain canvas nodes.`, [
      { severity: "error", message: "The canvas has no nodes array." },
    ]);
  }

  const issues: PipelineIssue[] = [];
  const steps: PipelineStep[] = [];
  const pipelineNodeIds = new Set<string>();

  for (const node of canvas.nodes) {
    if (node.type !== "text" || typeof node.id !== "string" || typeof node.text !== "string") {
      continue;
    }
    const blocks = extractStepBlocks(node.text);
    if (blocks.length === 0) continue;
    if (blocks.length > 1) {
      issues.push({
        severity: "warning",
        stepId: node.id,
        message: "This node has more than one langscape block; only the first is used.",
      });
    }
    const block = blocks[0];
    const parsed = stepConfigFromObject(block.config, node.id, node.text);
    issues.push(...parsed.issues);
    if (!parsed.step) continue;
    parsed.step.raw = block.raw;
    steps.push(parsed.step);
    pipelineNodeIds.add(node.id);
  }

  const edges: PipelineEdge[] = [];
  for (const edge of canvas.edges ?? []) {
    if (typeof edge.fromNode !== "string" || typeof edge.toNode !== "string") continue;
    if (!pipelineNodeIds.has(edge.fromNode) && !pipelineNodeIds.has(edge.toNode)) continue;
    if (!pipelineNodeIds.has(edge.fromNode) || !pipelineNodeIds.has(edge.toNode)) {
      issues.push({
        severity: "warning",
        message: "An edge connects a pipeline step to a non-pipeline canvas node and was ignored.",
      });
      continue;
    }
    if (edge.fromNode === edge.toNode) {
      issues.push({
        severity: "error",
        stepId: edge.fromNode,
        message: "A step cannot connect to itself.",
      });
      continue;
    }
    edges.push({ from: edge.fromNode, to: edge.toNode });
  }

  const graph: PipelineGraph = {
    canvasPath,
    title: canvas.nodes.find((node) => node.type === "text" && node.text)?.text?.slice(0, 60) ?? canvasPath,
    steps,
    edges,
    issues,
  };
  validatePipeline(graph);
  return graph;
}

export function stepConfigFromObject(
  config: Record<string, unknown>,
  id: string,
  nodeText = ""
): { step?: PipelineStep; issues: PipelineIssue[] } {
  const issues: PipelineIssue[] = [];
  const type = String(config.type ?? "").trim().toLowerCase();
  const kind = normalizeKind(type);
  if (!kind) {
    return {
      issues: [
        {
          severity: "error",
          stepId: id,
          message: `Unknown pipeline step type "${String(config.type ?? "")}". Use source, words, sound-change, or output.`,
        },
      ],
    };
  }

  const label =
    stringValue(config.label) ||
    firstMeaningfulLine(nodeText) ||
    defaultLabel(kind);
  const base = { id, kind, label };

  if (kind === "source") {
    const path = stringValue(config.path) || stringValue(config.folder);
    if (!path) {
      issues.push({
        severity: "error",
        stepId: id,
        message: "A source step needs a `path` (folder or .wli file).",
      });
    }
    const format = normalizeFormat(config.format, path);
    return {
      step: {
        ...base,
        kind: "source",
        path: path ?? "",
        format,
        field: stringValue(config.field) || "word",
      },
      issues,
    };
  }

  if (kind === "words") {
    const rawWords = config.words;
    const words = Array.isArray(rawWords)
      ? rawWords.map((word) => String(word).trim()).filter(Boolean)
      : typeof rawWords === "string"
        ? rawWords.split(/\r?\n/).map((word) => word.trim()).filter(Boolean)
        : [];
    if (words.length === 0) {
      issues.push({
        severity: "error",
        stepId: id,
        message: "A words step needs a non-empty `words` list.",
      });
    }
    return { step: { ...base, kind: "words", words }, issues };
  }

  if (kind === "sound-change") {
    const file = stringValue(config.file) || stringValue(config.path);
    const changes = stringValue(config.changes);
    if (!file && !changes) {
      issues.push({
        severity: "error",
        stepId: id,
        message: "A sound-change step needs a `file` pointing at a .lsc file (or inline `changes`).",
      });
    }
    return {
      step: {
        ...base,
        kind: "sound-change",
        file: file || undefined,
        changes: changes || undefined,
        startAt: stringValue(config.startAt) || stringValue(config["start-at"]) || undefined,
        stopBefore:
          stringValue(config.stopBefore) || stringValue(config["stop-before"]) || undefined,
      },
      issues,
    };
  }

  // output
  const path = stringValue(config.path) || stringValue(config.folder);
  if (!path) {
    issues.push({
      severity: "error",
      stepId: id,
      message: "An output step needs a `path` (folder, or a .wli file).",
    });
  }
  const format = normalizeFormat(config.format, path ?? "");
  if (format === "wli" && path && !/\.wli$/i.test(path)) {
    issues.push({
      severity: "warning",
      stepId: id,
      message: "A word-list output should usually point at a .wli file.",
    });
  }
  return {
    step: {
      ...base,
      kind: "output",
      path: path ?? "",
      format,
      field: stringValue(config.field) || "word",
      name: stringValue(config.name) || stringValue(config.language) || undefined,
      filename: stringValue(config.filename) || undefined,
      overwrite: config.overwrite !== false,
    },
    issues,
  };
}

export function validatePipeline(graph: PipelineGraph): PipelineIssue[] {
  const issues = graph.issues;
  const ids = new Set<string>();
  for (const step of graph.steps) {
    if (ids.has(step.id)) {
      pushIssue(issues, {
        severity: "error",
        stepId: step.id,
        message: "Two pipeline steps share the same canvas node id.",
      });
    }
    ids.add(step.id);
  }

  const validEdges = graph.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to));
  if (validEdges.length !== graph.edges.length) {
    pushIssue(issues, {
      severity: "error",
      message: "An edge refers to a step that is not part of the pipeline.",
    });
  }

  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();
  for (const step of graph.steps) {
    incoming.set(step.id, 0);
    outgoing.set(step.id, 0);
  }
  for (const edge of validEdges) {
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    outgoing.set(edge.from, (outgoing.get(edge.from) ?? 0) + 1);
  }

  for (const step of graph.steps) {
    const inCount = incoming.get(step.id) ?? 0;
    const outCount = outgoing.get(step.id) ?? 0;
    if ((step.kind === "source" || step.kind === "words") && inCount > 0) {
      pushIssue(issues, {
        severity: "error",
        stepId: step.id,
        message: `"${step.label}" is a ${step.kind} step and cannot have incoming edges.`,
      });
    }
    if (step.kind === "sound-change" && inCount === 0) {
      pushIssue(issues, {
        severity: "error",
        stepId: step.id,
        message: `"${step.label}" has no input. Connect a source or another sound-change step to it.`,
      });
    }
    if (step.kind === "output" && inCount === 0) {
      pushIssue(issues, {
        severity: "error",
        stepId: step.id,
        message: `"${step.label}" has no input. Connect the words you want to write.`,
      });
    }
    if (step.kind === "output" && outCount > 0) {
      pushIssue(issues, {
        severity: "warning",
        stepId: step.id,
        message: `"${step.label}" is an output; edges leaving it are ignored.`,
      });
    }
  }

  if (graph.steps.length === 0) {
    pushIssue(issues, {
      severity: "error",
      message:
        "No Langscape steps found. Add a text card containing a ```langscape block with `type: source`.",
    });
  }
  if (!graph.steps.some((step) => step.kind === "output")) {
    pushIssue(issues, { severity: "error", message: "The pipeline has no output step." });
  }
  if (!graph.steps.some((step) => step.kind === "source" || step.kind === "words")) {
    pushIssue(issues, { severity: "error", message: "The pipeline has no source or words step." });
  }


  // Feeding generated notes back into the source of the same pipeline creates
  // an accidental loop; catch it before writing anything.
  for (const output of graph.steps.filter((step) => step.kind === "output")) {
    if (output.kind !== "output") continue;
    for (const source of graph.steps.filter((step) => step.kind === "source")) {
      if (source.kind !== "source" || !source.path) continue;
      const sourceLooksLikeFolder = !/\.[a-z0-9]+$/i.test(source.path);
      if (!sourceLooksLikeFolder) continue;
      if (output.path === source.path || output.path.startsWith(source.path + "/")) {
        pushIssue(issues, {
          severity: "error",
          stepId: output.id,
          message: `"${output.label}" writes inside its source folder "${source.path}". That would feed generated notes back into the pipeline; choose a different output folder.`,
        });
      }
    }
  }

  try {
    topologicalOrder(graph);
  } catch (error) {
    pushIssue(issues, {
      severity: "error",
      message:
        error instanceof PipelineError
          ? error.message
          : "The pipeline graph contains a cycle.",
    });
  }

  return issues;
}

export function topologicalOrder(graph: PipelineGraph): PipelineStep[] {
  const byId = new Map(graph.steps.map((step) => [step.id, step]));
  const indegree = new Map(graph.steps.map((step) => [step.id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) continue;
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge.to);
    outgoing.set(edge.from, list);
  }

  const queue = graph.steps.filter((step) => (indegree.get(step.id) ?? 0) === 0);
  const ordered: PipelineStep[] = [];
  while (queue.length > 0) {
    const step = queue.shift()!;
    ordered.push(step);
    for (const next of outgoing.get(step.id) ?? []) {
      const remaining = (indegree.get(next) ?? 1) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) {
        const nextStep = byId.get(next);
        if (nextStep) queue.push(nextStep);
      }
    }
  }

  if (ordered.length !== graph.steps.length) {
    const blocked = graph.steps.filter((step) => !ordered.includes(step));
    throw new PipelineError(
      `The pipeline has a cycle involving: ${blocked.map((step) => step.label).join(", ")}.`,
      blocked.map((step) => ({
        severity: "error" as const,
        stepId: step.id,
        message: `"${step.label}" is part of a cycle.`,
      }))
    );
  }
  return ordered;
}

export function predecessors(graph: PipelineGraph, id: string): string[] {
  return graph.edges.filter((edge) => edge.to === id).map((edge) => edge.from);
}

export function errorsOnly(issues: PipelineIssue[]): PipelineIssue[] {
  return issues.filter((issue) => issue.severity === "error");
}

function pushIssue(issues: PipelineIssue[], issue: PipelineIssue): void {
  const duplicate = issues.some(
    (existing) =>
      existing.severity === issue.severity &&
      existing.stepId === issue.stepId &&
      existing.message === issue.message
  );
  if (!duplicate) issues.push(issue);
}

function normalizeKind(type: string): PipelineStepKind | undefined {
  switch (type) {
    case "source":
    case "folder":
    case "words-from-folder":
    case "extract":
      return "source";
    case "words":
    case "wordlist":
    case "inline":
      return "words";
    case "sound-change":
    case "soundchange":
    case "sound_change":
    case "lexurgy":
    case "sc":
      return "sound-change";
    case "output":
    case "sink":
    case "write":
    case "destination":
      return "output";
    default:
      return undefined;
  }
}

function normalizeFormat(value: unknown, path: string): "markdown" | "wli" {
  const raw = stringValue(value).toLowerCase();
  if (raw === "wli" || raw === "wordlist" || raw === "word-list") return "wli";
  if (raw === "md" || raw === "markdown" || raw === "note" || raw === "notes") return "markdown";
  return /\.wli$/i.test(path) ? "wli" : "markdown";
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return "";
}

function defaultLabel(kind: PipelineStepKind): string {
  switch (kind) {
    case "source":
      return "Source words";
    case "words":
      return "Inline words";
    case "sound-change":
      return "Sound changes";
    case "output":
      return "Output";
  }
}

function firstMeaningfulLine(text: string): string {
  const beforeBlock = text.split(/```langscape/i)[0] ?? "";
  return (
    beforeBlock
      .split(/\r?\n/)
      .map((line) => line.replace(/^#+\s*/, "").trim())
      .find((line) => line.length > 0) ?? ""
  ).slice(0, 80);
}
