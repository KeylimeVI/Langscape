#!/usr/bin/env node
/**
 * Validates a visual E2E run directory (report.json + all PNG screenshots) and
 * optionally prints the structured prompt for a visual-verification subagent.
 *
 * Usage:
 *   node scripts/visual-e2e/verify-report.mjs [--dir .tools/visual-e2e/latest] [--print-prompt]
 */
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ROOT_DIR, TOOLS_DIR } from "./lib/env.mjs";
import { inspectPng } from "./lib/report.mjs";

function parseArgs(argv) {
  const opts = {
    dir: path.join(TOOLS_DIR, "visual-e2e", "latest"),
    printPrompt: false,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dir" && argv[i + 1]) opts.dir = path.resolve(argv[++i]);
    else if (argv[i] === "--print-prompt") opts.printPrompt = true;
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const reportPath = path.join(opts.dir, "report.json");
  const promptPath = path.join(opts.dir, "verify-prompt.md");

  if (!existsSync(reportPath)) {
    throw new Error(`No report.json found in ${opts.dir}. Run "npm run test:visual" first.`);
  }

  const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
  let badPngs = 0;
  let totalPngs = 0;

  for (const scenario of report.scenarios) {
    for (const shot of scenario.screenshots) {
      totalPngs++;
      const resolved = path.isAbsolute(shot.filePath) ? shot.filePath : path.join(ROOT_DIR, shot.relativePath);
      if (!existsSync(resolved)) {
        console.error(`[verify-report] MISSING PNG: ${shot.relativePath}`);
        badPngs++;
        continue;
      }
      const meta = await inspectPng(resolved);
      if (!meta.valid) {
        console.error(`[verify-report] INVALID PNG: ${shot.relativePath} (${meta.reason})`);
        badPngs++;
      }
    }
  }

  if (opts.printPrompt) {
    console.log(await fs.readFile(promptPath, "utf8"));
  } else {
    console.log(
      `[verify-report] Scenarios: ${report.summary.passed}/${report.summary.totalScenarios} passed | ` +
        `PNGs: ${totalPngs - badPngs}/${totalPngs} valid | ` +
        `Exceptions: ${report.summary.uncaughtExceptions}`
    );
    console.log(`[verify-report] Prompt:  ${path.relative(ROOT_DIR, promptPath)}`);
    console.log(`[verify-report] Gallery: ${path.relative(ROOT_DIR, path.join(opts.dir, "index.html"))}`);
  }

  if (!report.summary.ok || badPngs > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`[verify-report] ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
