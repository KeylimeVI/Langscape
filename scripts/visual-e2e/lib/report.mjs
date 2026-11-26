/**
 * Structured report, PNG verification, visual-review prompt, and HTML gallery generator.
 */
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export async function inspectPng(filePath) {
  const buf = await fs.readFile(filePath);
  if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { valid: false, reason: "Invalid PNG signature", bytes: buf.length, width: 0, height: 0 };
  }
  const chunkType = buf.subarray(12, 16).toString("ascii");
  if (chunkType !== "IHDR") {
    return { valid: false, reason: `Unexpected first chunk ${chunkType}`, bytes: buf.length, width: 0, height: 0 };
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (width < 16 || height < 16) {
    return { valid: false, reason: `Image too small (${width}x${height})`, bytes: buf.length, width, height };
  }
  if (buf.length < 1024) {
    return { valid: false, reason: `Suspiciously tiny PNG (${buf.length} bytes)`, bytes: buf.length, width, height };
  }
  return { valid: true, bytes: buf.length, width, height };
}

function getGitRevision(cwd) {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

export class TestRunRecorder {
  constructor({ runDir, rootDir, targets, environment = {} }) {
    this.runDir = runDir;
    this.rootDir = rootDir;
    this.screenshotsDir = path.join(runDir, "screenshots");
    this.startedAt = new Date().toISOString();
    this.targets = targets;
    this.environment = environment;
    this.scenarios = [];
    this.consoleErrors = [];
    this.exceptions = [];
  }

  async init() {
    await fs.mkdir(this.screenshotsDir, { recursive: true });
  }

  screenshotPath(filename) {
    return path.join(this.screenshotsDir, filename);
  }

  async recordScenario(entry) {
    const validatedScreenshots = [];
    for (const shot of entry.screenshots ?? []) {
      let meta = { valid: false, reason: "Missing file", bytes: 0, width: 0, height: 0 };
      try {
        meta = await inspectPng(shot.filePath);
      } catch (error) {
        meta.reason = error instanceof Error ? error.message : String(error);
      }
      validatedScreenshots.push({
        id: shot.id,
        caption: shot.caption,
        filePath: shot.filePath,
        relativePath: path.relative(this.rootDir, shot.filePath),
        gallerySrc: path.relative(this.runDir, shot.filePath),
        checkCriteria: shot.checkCriteria ?? [],
        ...meta,
      });
    }
    this.scenarios.push({
      id: entry.id,
      title: entry.title,
      target: entry.target,
      status: entry.status,
      durationMs: entry.durationMs,
      assertions: entry.assertions ?? [],
      error: entry.error ?? null,
      screenshots: validatedScreenshots,
    });
  }

  addRuntimeErrors(target, { consoleErrors = [], exceptions = [] }) {
    for (const err of consoleErrors) {
      this.consoleErrors.push({ target, ...err });
    }
    for (const exc of exceptions) {
      this.exceptions.push({ target, ...exc });
    }
  }

  buildReport() {
    const passed = this.scenarios.filter((s) => s.status === "pass").length;
    const failed = this.scenarios.filter((s) => s.status === "fail").length;
    const skipped = this.scenarios.filter((s) => s.status === "skip").length;
    const screenshots = this.scenarios.flatMap((s) => s.screenshots);
    const invalidScreenshots = screenshots.filter((s) => !s.valid);
    return {
      schemaVersion: 1,
      startedAt: this.startedAt,
      finishedAt: new Date().toISOString(),
      gitRevision: getGitRevision(this.rootDir),
      runDir: path.relative(this.rootDir, this.runDir),
      targets: this.targets,
      environment: this.environment,
      summary: {
        totalScenarios: this.scenarios.length,
        passed,
        failed,
        skipped,
        totalScreenshots: screenshots.length,
        invalidScreenshots: invalidScreenshots.length,
        consoleErrors: this.consoleErrors.length,
        uncaughtExceptions: this.exceptions.length,
        ok: failed === 0 && invalidScreenshots.length === 0,
      },
      scenarios: this.scenarios,
      consoleErrors: this.consoleErrors,
      exceptions: this.exceptions,
    };
  }

  async finalize(latestLinkDir = null) {
    const report = this.buildReport();
    const reportPath = path.join(this.runDir, "report.json");
    const promptPath = path.join(this.runDir, "verify-prompt.md");
    const galleryPath = path.join(this.runDir, "index.html");

    await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
    await fs.writeFile(promptPath, renderVerifyPrompt(report), "utf8");
    await fs.writeFile(galleryPath, renderHtmlGallery(report), "utf8");

    if (latestLinkDir) {
      await fs.rm(latestLinkDir, { recursive: true, force: true });
      await fs.symlink(this.runDir, latestLinkDir, "dir").catch(async () => {
        await fs.cp(this.runDir, latestLinkDir, { recursive: true });
      });
    }

    return { report, reportPath, promptPath, galleryPath };
  }
}

export function renderVerifyPrompt(report) {
  const lines = [
    "# Langscape Visual E2E Verification Brief",
    "",
    "You are verifying screenshots captured by Langscape's automated Obsidian E2E test harness.",
    "Inspect EVERY screenshot listed below using your image-reading tool and check whether each feature actually looks right and works cleanly for an end user.",
    "",
    "Do NOT blindly trust automated DOM assertions — look closely at the actual rendered pixels for:",
    "- Missing glyphs / tofu boxes (`□`) or raw `{FontName: ...}` / `{tree: ...}` markup leaking where rendered output is expected",
    "- Clipped text, overlapping labels, misaligned SVG tree edges, or broken merged-table borders",
    "- Unreadable contrast in dark or light mode",
    "- Mobile layout overflows, cut-off modals, or desktop-only UI accidentally appearing on mobile",
    "",
    "## Run Summary",
    `- Targets: ${report.targets.join(", ")}`,
    `- Git revision: ${report.gitRevision}`,
    `- Automated scenarios: ${report.summary.passed}/${report.summary.totalScenarios} passed (${report.summary.failed} failed)`,
    `- Screenshots captured: ${report.summary.totalScreenshots} (${report.summary.invalidScreenshots} invalid)`,
    `- Uncaught renderer exceptions: ${report.summary.uncaughtExceptions}`,
    "",
    "## Screenshots to Inspect",
    "",
  ];

  for (const scenario of report.scenarios) {
    lines.push(`### [${scenario.target}] ${scenario.id} — ${scenario.title} (${scenario.status.toUpperCase()})`);
    if (scenario.error) {
      lines.push(`- **Error**: ${scenario.error}`);
    }
    if (scenario.assertions.length > 0) {
      lines.push(`- Automated checks passed: ${scenario.assertions.join("; ")}`);
    }
    for (const shot of scenario.screenshots) {
      lines.push(`- **Image**: \`${shot.relativePath}\` (${shot.width}x${shot.height}) — ${shot.caption}`);
      for (const criterion of shot.checkCriteria) {
        lines.push(`  - [ ] ${criterion}`);
      }
    }
    lines.push("");
  }

  lines.push("## Required Output Format");
  lines.push("Return a concise Markdown table with columns `Screenshot | Verdict (PASS / WARN / FAIL) | Visual Observations`, followed by any concrete bugs or UI polish issues found.");
  lines.push("");
  return lines.join("\n");
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderHtmlGallery(report) {
  const cards = report.scenarios
    .map((scenario) => {
      const badgeClass = scenario.status === "pass" ? "pass" : scenario.status === "fail" ? "fail" : "skip";
      const shots = scenario.screenshots
        .map(
          (shot) => `
          <figure class="shot">
            <a href="${escapeHtml(shot.gallerySrc)}" target="_blank">
              <img src="${escapeHtml(shot.gallerySrc)}" alt="${escapeHtml(shot.caption)}" loading="lazy" />
            </a>
            <figcaption>
              <strong>${escapeHtml(shot.id)}</strong> (${shot.width}×${shot.height}) — ${escapeHtml(shot.caption)}
              <ul>${shot.checkCriteria.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ul>
            </figcaption>
          </figure>`
        )
        .join("\n");
      return `
        <section class="scenario">
          <header>
            <span class="badge ${badgeClass}">${escapeHtml(scenario.status.toUpperCase())}</span>
            <span class="target">${escapeHtml(scenario.target)}</span>
            <h2>${escapeHtml(scenario.id)} — ${escapeHtml(scenario.title)}</h2>
            <span class="dur">${scenario.durationMs} ms</span>
          </header>
          ${scenario.error ? `<pre class="err">${escapeHtml(scenario.error)}</pre>` : ""}
          ${
            scenario.assertions.length
              ? `<p class="assertions"><strong>Verified:</strong> ${escapeHtml(scenario.assertions.join(" · "))}</p>`
              : ""
          }
          <div class="shots">${shots}</div>
        </section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Langscape Visual E2E Report (${escapeHtml(report.startedAt)})</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #0f1115; color: #e6e9ef; margin: 0; padding: 24px; line-height: 1.45; }
    h1 { margin: 0 0 8px; }
    .meta { color: #9aa4b2; margin-bottom: 24px; }
    .scenario { background: #161a21; border: 1px solid #262c36; border-radius: 10px; padding: 16px 20px; margin-bottom: 20px; }
    .scenario header { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 10px; }
    .scenario h2 { margin: 0; font-size: 1.05rem; flex: 1; }
    .badge { font-size: 0.75rem; font-weight: 700; padding: 2px 8px; border-radius: 999px; }
    .badge.pass { background: #123828; color: #2bf6a3; }
    .badge.fail { background: #3f151b; color: #ff6b81; }
    .badge.skip { background: #2c313c; color: #b8c0cc; }
    .target { font-size: 0.75rem; padding: 2px 8px; border-radius: 6px; background: #232a36; color: #9ecbff; }
    .dur { color: #8c96a6; font-size: 0.8rem; }
    .assertions { color: #b5c0cf; font-size: 0.88rem; margin: 6px 0 12px; }
    .err { background: #2b1216; color: #ff9aa8; padding: 10px; border-radius: 6px; overflow: auto; }
    .shots { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 16px; }
    .shot { margin: 0; background: #0c0e12; border: 1px solid #242a34; border-radius: 8px; padding: 10px; }
    .shot img { max-width: 100%; height: auto; display: block; border-radius: 4px; border: 1px solid #1f2530; }
    .shot figcaption { margin-top: 8px; font-size: 0.85rem; color: #cfd6e1; }
    .shot ul { margin: 6px 0 0; padding-left: 18px; color: #9aa4b2; font-size: 0.8rem; }
  </style>
</head>
<body>
  <h1>Langscape Visual E2E Report</h1>
  <div class="meta">
    Started: ${escapeHtml(report.startedAt)} · Git: ${escapeHtml(report.gitRevision)} ·
    Scenarios: ${report.summary.passed}/${report.summary.totalScenarios} passed ·
    Screenshots: ${report.summary.totalScreenshots}
  </div>
  ${cards}
</body>
</html>
`;
}
