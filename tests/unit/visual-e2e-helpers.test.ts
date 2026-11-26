import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findUiNode, parseAdbDevices, parseBounds, parseUiHierarchy } from "../../scripts/visual-e2e/lib/android-ui.mjs";
import { inspectPng, renderHtmlGallery, renderVerifyPrompt } from "../../scripts/visual-e2e/lib/report.mjs";

describe("visual-e2e android UIAutomator & ADB helpers", () => {
  it("parses adb devices -l output cleanly", () => {
    const sample = [
      "List of devices attached",
      "emulator-5554          device product:sdk_gphone64_x86_64 model:sdk_gphone64_x86_64 device:emu64xa transport_id:1",
      "192.168.1.42:37891     device product:panther model:Pixel_7 device:panther",
      "R5CT123456A            offline",
      "",
    ].join("\n");

    const devices = parseAdbDevices(sample);
    expect(devices).toHaveLength(3);
    expect(devices[0]).toMatchObject({ serial: "emulator-5554", state: "device", model: "sdk_gphone64_x86_64" });
    expect(devices[1]).toMatchObject({ serial: "192.168.1.42:37891", state: "device", model: "Pixel_7" });
    expect(devices[2]).toMatchObject({ serial: "R5CT123456A", state: "offline" });
  });

  it("parses Android UIAutomator XML hierarchy and finds clickable bounds", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <hierarchy rotation="0">
        <node index="0" text="Trust author &amp; enable plugins" resource-id="md.obsidian:id/trust" class="android.widget.Button" content-desc="" clickable="true" enabled="true" bounds="[100,1200][980,1340]" />
        <node index="1" text="" resource-id="" class="android.view.View" content-desc="Open settings" clickable="true" enabled="true" bounds="[0,0][120,120]" />
      </hierarchy>`;

    const nodes = parseUiHierarchy(xml);
    expect(nodes).toHaveLength(2);
    expect(nodes[0].text).toBe("Trust author & enable plugins");
    expect(nodes[0].bounds).toMatchObject({ cx: 540, cy: 1270, width: 880, height: 140 });

    const trust = findUiNode(nodes, { textRegex: /trust author/i });
    expect(trust?.resourceId).toBe("md.obsidian:id/trust");

    const settings = findUiNode(nodes, { contentDesc: "Open settings" });
    expect(settings?.bounds).toMatchObject({ cx: 60, cy: 60 });
    expect(parseBounds("invalid")).toBeNull();
  });
});

describe("visual-e2e report & PNG validation helpers", () => {
  it("validates PNG signatures and rejects truncated or non-PNG files", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "langscape-png-test-"));
    try {
      const badFile = path.join(tmpDir, "bad.png");
      await fs.writeFile(badFile, "not a png");
      expect((await inspectPng(badFile)).valid).toBe(false);

      // Minimal synthetic PNG header + IHDR (128x96) padded over 1024 bytes.
      const goodBuf = Buffer.alloc(1200, 0);
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(goodBuf, 0);
      goodBuf.writeUInt32BE(13, 8);
      goodBuf.write("IHDR", 12, "ascii");
      goodBuf.writeUInt32BE(128, 16);
      goodBuf.writeUInt32BE(96, 20);
      const goodFile = path.join(tmpDir, "good.png");
      await fs.writeFile(goodFile, goodBuf);

      expect(await inspectPng(goodFile)).toMatchObject({ valid: true, width: 128, height: 96, bytes: 1200 });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("renders a subagent verification prompt and HTML gallery", () => {
    const report = {
      startedAt: "2026-11-25T00:00:00.000Z",
      gitRevision: "abc1234",
      targets: ["desktop", "mobile-emulated"],
      summary: {
        totalScenarios: 1,
        passed: 1,
        failed: 0,
        skipped: 0,
        totalScreenshots: 1,
        invalidScreenshots: 0,
        consoleErrors: 0,
        uncaughtExceptions: 0,
        ok: true,
      },
      scenarios: [
        {
          id: "d01-fonts",
          title: "Custom fonts",
          target: "desktop",
          status: "pass",
          durationMs: 420,
          assertions: ["FontFace loaded"],
          error: null,
          screenshots: [
            {
              id: "d01-fonts",
              caption: "Gothic glyphs rendered",
              relativePath: ".tools/visual-e2e/latest/screenshots/d01-fonts.png",
              gallerySrc: "screenshots/d01-fonts.png",
              width: 1440,
              height: 900,
              valid: true,
              checkCriteria: ["Gothic glyphs render cleanly."],
            },
          ],
        },
      ],
    };

    const prompt = renderVerifyPrompt(report);
    expect(prompt).toContain("Langscape Visual E2E Verification Brief");
    expect(prompt).toContain(".tools/visual-e2e/latest/screenshots/d01-fonts.png");
    expect(prompt).toContain("Gothic glyphs render cleanly.");

    const html = renderHtmlGallery(report);
    expect(html).toContain("<img src=\"screenshots/d01-fonts.png\"");
    expect(html).toContain("d01-fonts");
  });
});
