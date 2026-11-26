# Langscape Visual E2E & Mobile Testing System

Automated end-to-end testing harness that launches real Obsidian instances (desktop, Android-emulated mobile, and real Android via ADB), drives every user-facing feature with real pointer/touch/keyboard interactions, checks DOM/file assertions, and captures structured screenshots ready for visual verification by an AI agent or human reviewer.

## Quick Commands

| Command | What it does |
| --- | --- |
| `npm run test:visual` | Build plugin and run **both** Desktop (10 scenarios) and Mobile/Android-emulated (5 scenarios) suites |
| `npm run test:visual:desktop` | Run Desktop Obsidian suite only (uses real Java + Lexurgy when available) |
| `npm run test:visual:mobile` | Run Android-emulated Mobile Obsidian suite (`EmulateMobile=1`, 412×915 Pixel 7 @2x, touch events, strict Node-blocked sandbox) |
| `npm run test:visual:verify` | Validate latest `report.json` and verify every PNG screenshot is non-empty and valid |
| `npm run test:visual:setup-android` | Download official Android `platform-tools` (`adb`) and latest `Obsidian-*.apk` into `.tools/android/` (add `-- --create-avd` on a KVM host to create an Android 14 Pixel 7 AVD) |
| `npm run test:visual:android` | Run the real Android ADB suite against an attached Android phone (USB or `-- --connect <ip>:<port>`) or local KVM AVD (`-- --boot-avd langscape-pixel7`) |

## Filtering & Options

```bash
# Run specific scenarios only
node scripts/visual-e2e/run.mjs --target desktop --only d05,d06

# Run visibly (or under xvfb-run) instead of headless
xvfb-run -a node scripts/visual-e2e/run.mjs --target desktop --headed

# Also test live HTTPS fetch for the in-app Lexurgy Docs tab
node scripts/visual-e2e/run.mjs --target desktop --live-docs

# Print the ready-to-use visual verification prompt for a subagent
node scripts/visual-e2e/verify-report.mjs --print-prompt
```

## Outputs

Every run creates a timestamped directory under `.tools/visual-e2e/` and updates `.tools/visual-e2e/latest/`:

- `screenshots/*.png` — Full-viewport and cropped feature screenshots (plus `*-FAILED.png` on error)
- `report.json` — Machine-readable scenario results, assertions, PNG metadata, console errors, and visual rubrics
- `verify-prompt.md` — Ready-to-dispatch prompt listing every screenshot path and exact visual acceptance checklist for a weaker visual-verifier subagent
- `index.html` — Self-contained dark-mode visual gallery for quick browser review

## Two Layers of Android Testing

1. **Instant Android Mobile Emulation (`npm run test:visual:mobile`)**:
   Runs anywhere (including containers/CI without `/dev/kvm`) using real Obsidian with `localStorage.EmulateMobile = "1"` (genuine Obsidian phone UI), a Pixel 7 viewport (`412×915 @2x`), Android WebView User-Agent, CDP touch events, and a strict JS module wrapper that blocks all Node.js APIs.
2. **Real Android via ADB (`npm run test:visual:android`)**:
   Runs the official `Obsidian-*.apk` on a real Android device (USB or Wireless Debugging via `--connect <ip>:<port>`) or a local KVM Android Emulator (`--boot-avd langscape-pixel7`), pushes a staged vault, navigates via UIAutomator + `obsidian://open` deep links, and captures real Android framebuffer screenshots via `adb exec-out screencap -p`.
