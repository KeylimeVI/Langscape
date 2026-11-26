#!/usr/bin/env node
/**
 * Langscape Visual E2E Test Runner
 *
 * Launches real Obsidian instances (desktop and/or Android-emulated mobile),
 * interacts with every user-facing feature, validates functional assertions,
 * captures screenshots, and writes a structured visual verification report +
 * subagent verification prompt + HTML contact sheet.
 *
 * Usage:
 *   node scripts/visual-e2e/run.mjs [--target desktop|mobile|all]
 *                                   [--only d01,m02]
 *                                   [--headed]
 *                                   [--live-docs]
 *                                   [--keep]
 *                                   [--out <dir>]
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { ROOT_DIR, TOOLS_DIR, resolveJavaBin, resolveLexurgyPath, resolveObsidianBin } from "./lib/env.mjs";
import { launchObsidianSession } from "./lib/obsidian-runner.mjs";
import { TestRunRecorder } from "./lib/report.mjs";
import { getDesktopScenarios } from "./suites/desktop.mjs";
import { getMobileScenarios } from "./suites/mobile.mjs";

function parseArgs(argv) {
  const opts = {
    target: "all",
    only: null,
    headed: false,
    liveDocs: false,
    keep: false,
    outDir: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--target" && argv[i + 1]) opts.target = argv[++i];
    else if (arg === "--only" && argv[i + 1]) opts.only = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (arg === "--headed") opts.headed = true;
    else if (arg === "--live-docs") opts.liveDocs = true;
    else if (arg === "--keep") opts.keep = true;
    else if (arg === "--out" && argv[i + 1]) opts.outDir = path.resolve(argv[++i]);
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/visual-e2e/run.mjs [options]
  --target desktop|mobile|all   Which Obsidian suites to run (default: all)
  --only id1,id2                Filter scenarios by ID prefix
  --headed                      Run with visible window (requires DISPLAY or xvfb-run)
  --live-docs                   Verify live HTTPS Lexurgy docs fetch
  --keep                        Keep disposable test vaults after a passing run
  --out <dir>                   Output directory for screenshots and report`);
      process.exit(0);
    }
  }
  return opts;
}

function log(msg) {
  console.log(`[visual-e2e] ${msg}`);
}

async function runTargetSuite({ target, mobile, scenarios, opts, recorder, runDir }) {
  const filtered = opts.only
    ? scenarios.filter((s) => opts.only.some((prefix) => s.id.startsWith(prefix)))
    : scenarios;
  if (filtered.length === 0) return true;

  const workDir = path.join(runDir, `env-${target}`);
  const session = await launchObsidianSession({
    workDir,
    mobile,
    headed: opts.headed,
    port: mobile ? Number(process.env.OBSIDIAN_MOBILE_CDP_PORT ?? 9266) : Number(process.env.OBSIDIAN_CDP_PORT ?? 9265),
    keep: opts.keep,
    log,
  });

  let allPassed = true;
  try {
    for (const scenario of filtered) {
      const started = Date.now();
      log(`[${target}] running ${scenario.id} — ${scenario.title}`);
      try {
        const result = await scenario.run({ cdp: session.cdp, session, recorder });
        const durationMs = Date.now() - started;
        await recorder.recordScenario({
          id: scenario.id,
          title: scenario.title,
          target,
          status: "pass",
          durationMs,
          assertions: result.assertions ?? [],
          screenshots: result.screenshots ?? [],
        });
        log(`[${target}] PASS ${scenario.id} (${durationMs}ms, ${(result.screenshots ?? []).length} screenshot(s))`);
      } catch (error) {
        allPassed = false;
        const durationMs = Date.now() - started;
        const message = error instanceof Error ? error.message : String(error);
        const failShot = recorder.screenshotPath(`${scenario.id}-FAILED.png`);
        const screenshots = [];
        try {
          await session.cdp.captureViewport(failShot);
          screenshots.push({
            id: `${scenario.id}-FAILED`,
            filePath: failShot,
            caption: `Failure state when ${scenario.id} threw: ${message}`,
            checkCriteria: ["Inspect why this scenario failed in the rendered UI."],
          });
        } catch {
          // Renderer may be unresponsive.
        }
        await recorder.recordScenario({
          id: scenario.id,
          title: scenario.title,
          target,
          status: "fail",
          durationMs,
          error: message,
          screenshots,
        });
        console.error(`[visual-e2e] FAIL ${scenario.id}: ${message}`);
      }
    }
    recorder.addRuntimeErrors(target, session.cdp.snapshotErrors());
  } finally {
    await session.close(allPassed);
  }
  return allPassed;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const targets =
    opts.target === "all"
      ? ["desktop", "mobile-emulated"]
      : opts.target === "desktop"
      ? ["desktop"]
      : opts.target === "mobile"
      ? ["mobile-emulated"]
      : (() => {
          throw new Error(`Invalid --target "${opts.target}". Expected desktop, mobile, or all.`);
        })();

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = opts.outDir ?? path.join(TOOLS_DIR, "visual-e2e", `run-${stamp}`);
  const latestLink = path.join(TOOLS_DIR, "visual-e2e", "latest");

  const environment = {
    obsidianBin: resolveObsidianBin(),
    javaBin: resolveJavaBin(),
    lexurgyPath: await resolveLexurgyPath(),
    headed: opts.headed,
    platform: process.platform,
    arch: process.arch,
  };

  const recorder = new TestRunRecorder({ runDir, rootDir: ROOT_DIR, targets, environment });
  await recorder.init();

  let ok = true;
  if (targets.includes("desktop")) {
    const passed = await runTargetSuite({
      target: "desktop",
      mobile: false,
      scenarios: getDesktopScenarios({ liveDocs: opts.liveDocs }),
      opts,
      recorder,
      runDir,
    });
    ok = ok && passed;
  }

  if (targets.includes("mobile-emulated")) {
    const passed = await runTargetSuite({
      target: "mobile-emulated",
      mobile: true,
      scenarios: getMobileScenarios(),
      opts,
      recorder,
      runDir,
    });
    ok = ok && passed;
  }

  const { report, reportPath, promptPath, galleryPath } = await recorder.finalize(latestLink);
  log(`Report JSON:    ${path.relative(ROOT_DIR, reportPath)}`);
  log(`Verify prompt:  ${path.relative(ROOT_DIR, promptPath)}`);
  log(`HTML gallery:   ${path.relative(ROOT_DIR, galleryPath)}`);
  log(
    `Summary: ${report.summary.passed}/${report.summary.totalScenarios} passed, ` +
      `${report.summary.totalScreenshots} screenshots (${report.summary.invalidScreenshots} invalid), ` +
      `${report.summary.uncaughtExceptions} renderer exception(s)`
  );

  if (!ok || !report.summary.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`[visual-e2e] FATAL: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exit(1);
});
