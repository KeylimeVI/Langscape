import { Notice, setIcon, type MarkdownPostProcessorContext } from "obsidian";
import type LangscapePlugin from "../main";
import { defaultPipelineName } from "./output";
import {
  errorsOnly,
  parseStepBlock,
  stepConfigFromObject,
  type PipelineIssue,
  type PipelineStep,
} from "./model";

const CANVAS_EVENT = "langscape:canvas-modified";

export function createPipelineCodeBlockProcessor(plugin: LangscapePlugin) {
  return async (
    source: string,
    el: HTMLElement,
    context: MarkdownPostProcessorContext
  ): Promise<void> => {
    el.empty();
    const parsed = parseStepBlock(source);
    const card = el.createDiv({ cls: "langscape-node-card" });
    if (!parsed) {
      card.addClass("is-invalid");
      card.createDiv({ cls: "langscape-node-error", text: "Could not parse this block." });
      return;
    }

    const local = stepConfigFromObject(parsed.config, "preview", source);
    const canvasPath = context.sourcePath.toLowerCase().endsWith(".canvas")
      ? context.sourcePath
      : plugin.getActiveCanvasFile()?.path;
    const body = card.createDiv({ cls: "langscape-node-body" });
    let version = 0;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let currentStep: PipelineStep | undefined;
    let currentCanvasPath: string | undefined;

    const update = async (patch: Record<string, string | undefined>): Promise<void> => {
      if (!currentCanvasPath || !currentStep) return;
      await plugin.updateCanvasStep(currentCanvasPath, currentStep.id, patch);
    };

    const choosePath = async (step: PipelineStep, anchor: HTMLElement): Promise<void> => {
      if (step.kind === "words") return;
      const kind = step.kind;
      const current = step.kind === "sound-change" ? step.file : step.path;
      const chosen = await plugin.pickStepPath(kind, anchor, current);
      if (!chosen) return;
      await update(kind === "sound-change" ? { file: chosen } : { path: chosen });
    };

    const render = async (): Promise<void> => {
      const token = ++version;
      const issues: PipelineIssue[] = [...local.issues];
      let step: PipelineStep | undefined = local.step;
      let hasErrors = local.issues.some((issue) => issue.severity === "error");

      if (canvasPath) {
        try {
          const graph = await plugin.getLiveCanvasGraph(canvasPath);
          if (token !== version) return;
          const match = graph.steps.find((candidate) => candidate.raw?.trim() === source.trim());
          if (match) {
            step = match;
            issues.push(...graph.issues.filter((issue) => issue.stepId === match.id));
            if (step.kind === "output" && errorsOnly(graph.issues).length > 0) {
              for (const issue of errorsOnly(graph.issues)) {
                if (!issue.stepId) issues.push(issue);
              }
            }
            card.dataset.stepId = match.id;
          }
          card.dataset.canvasPath = canvasPath;
        } catch (error) {
          issues.push({
            severity: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (step) {
        if (
          step.kind === "source" &&
          step.path &&
          !plugin.app.vault.getAbstractFileByPath(step.path)
        ) {
          issues.push({ severity: "error", message: `Source not found: ${step.path}` });
        }
        if (
          step.kind === "sound-change" &&
          step.file &&
          !plugin.app.vault.getAbstractFileByPath(step.file)
        ) {
          issues.push({ severity: "error", message: `Sound-change file not found: ${step.file}` });
        }
      }
      if (token !== version) return;
      currentStep = step;
      currentCanvasPath = canvasPath;
      if (step) card.dataset.stepKind = step.kind;
      hasErrors = issues.some((issue) => issue.severity === "error");
      body.empty();
      card.toggleClass("is-invalid", hasErrors);

      const header = body.createDiv({ cls: "langscape-node-header" });
      const icon = header.createSpan({ cls: "langscape-node-icon" });
      setIcon(icon, step ? iconFor(step) : "alert-triangle");
      if (step?.kind === "output") {
        const title = header.createEl("input", {
          cls: "langscape-node-title-input",
          attr: {
            type: "text",
            spellcheck: "false",
            "aria-label": "Pipeline name",
            title: "Pipeline name (defaults to the output folder)",
          },
        });
        title.value = step.name?.trim() || defaultPipelineName(step.path);
        title.disabled = !canvasPath;
        title.addEventListener("dblclick", (event) => event.stopPropagation());
        title.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            title.blur();
          }
        });
        title.addEventListener("change", () => {
          const fallback = defaultPipelineName(step.path);
          const value = title.value.trim();
          void update({ name: value && value !== fallback ? value : undefined });
        });
      } else {
        header.createSpan({ cls: "langscape-node-label", text: step?.label ?? "Invalid step" });
      }

      if (!step) {
        for (const issue of issues) {
          body.createDiv({ cls: `langscape-node-error is-${issue.severity}`, text: issue.message });
        }
        return;
      }

      if (step.kind !== "words") {
        const path = body.createDiv({
          cls: "langscape-node-detail langscape-node-path",
          text: describeStep(step),
        });
        path.setAttr("title", "Double-click to choose a different location");
        path.addEventListener("dblclick", (event) => {
          event.preventDefault();
          event.stopPropagation();
          void choosePath(step, path);
        });
      } else {
        body.createDiv({ cls: "langscape-node-detail", text: describeStep(step) });
      }

      if (step.kind === "source" || step.kind === "output") {
        const row = body.createDiv({ cls: "langscape-node-field" });
        row.createSpan({ cls: "langscape-node-field-label", text: "field" });
        const input = row.createEl("input", {
          cls: "langscape-node-field-input",
          attr: {
            type: "text",
            spellcheck: "false",
            "aria-label": "Word property",
            title: "Frontmatter property for the word",
          },
        });
        input.value = step.field || "word";
        input.disabled = !canvasPath;
        input.addEventListener("dblclick", (event) => event.stopPropagation());
        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            input.blur();
          }
        });
        input.addEventListener("change", () => {
          const value = input.value.trim();
          void update({ field: value && value !== "word" ? value : undefined });
        });
      }

      for (const issue of issues) {
        body.createDiv({ cls: `langscape-node-issue is-${issue.severity}`, text: issue.message });
      }

      if (step.kind !== "output" || !canvasPath) return;
      const actions = body.createDiv({ cls: "langscape-node-actions" });
      const run = actions.createEl("button", { cls: "mod-cta langscape-node-run", text: "Run" });
      run.disabled = hasErrors;
      run.addEventListener("click", async () => {
        run.disabled = true;
        run.setText("Running…");
        try {
          await plugin.runCanvasByPath(canvasPath, { targetNodeId: step!.id });
        } catch (error) {
          new Notice(
            `Langscape pipeline failed: ${error instanceof Error ? error.message : String(error)}`
          );
        } finally {
          run.disabled = false;
          run.setText("Run");
        }
      });
    };

    // Keep the canvas text metadata out of the way: double-clicking the card
    // body never enters canvas text editing. Inputs, buttons, and the path row
    // have their own behaviour.
    card.addEventListener("dblclick", (event) => {
      const target = event.target as HTMLElement;
      if (target.closest("input, button, .langscape-node-path")) {
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (currentStep?.kind === "sound-change" && currentStep.file) {
        void plugin.openVaultPath(currentStep.file);
      }
    });

    void render();

    if (!canvasPath) return;
    const onCanvasModified = (path: string): void => {
      if (path !== canvasPath) return;
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        void render();
      }, 180);
    };
    const ref = (plugin.app.workspace as any).on(CANVAS_EVENT, onCanvasModified);
    const observer = new MutationObserver(() => {
      if (el.isConnected) return;
      observer.disconnect();
      plugin.app.workspace.offref(ref);
      if (refreshTimer) clearTimeout(refreshTimer);
    });
    observer.observe(el.ownerDocument.body, { childList: true, subtree: true });
  };
}

function describeStep(step: PipelineStep): string {
  switch (step.kind) {
    case "source":
      return step.path || "(no path)";
    case "words":
      return `${step.words.length} words`;
    case "sound-change":
      return step.file ?? "Inline changes";
    case "output":
      return step.path || "(no path)";
  }
}

function iconFor(step: PipelineStep): string {
  switch (step.kind) {
    case "source":
      return "folder";
    case "words":
      return "list";
    case "sound-change":
      return "music";
    case "output":
      return "save";
  }
}
