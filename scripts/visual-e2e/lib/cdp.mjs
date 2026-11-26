/**
 * Lightweight Chrome DevTools Protocol client for driving Obsidian Electron
 * windows with real mouse, touch, keyboard, and screenshot actions.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitFor(fn, timeoutMs, label, intervalMs = 200) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  const detail = lastError instanceof Error ? ` (${lastError.message})` : "";
  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${label}${detail}`);
}

export async function listTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) throw new Error(`CDP target list returned HTTP ${response.status}`);
  return response.json();
}

export class CdpClient {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.consoleErrors = [];
    this.exceptions = [];

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
        return;
      }
      if (message.method === "Runtime.exceptionThrown") {
        const details = message.params?.exceptionDetails;
        const text =
          details?.exception?.description ??
          details?.text ??
          "Unhandled renderer exception";
        this.exceptions.push({ timestamp: Date.now(), text });
      } else if (message.method === "Runtime.consoleAPICalled") {
        const type = message.params?.type;
        if (type === "error") {
          const text = (message.params?.args ?? [])
            .map((arg) => arg.value ?? arg.description ?? arg.type)
            .join(" ");
          this.consoleErrors.push({ timestamp: Date.now(), text });
        }
      }
    };
  }

  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error(`Could not connect to CDP at ${wsUrl}`));
    });
    const client = new CdpClient(ws);
    await client.send("Runtime.enable");
    await client.send("Page.enable");
    return client;
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text ??
          "CDP evaluation failed"
      );
    }
    return result.result?.value;
  }

  async configureViewport({
    width,
    height,
    deviceScaleFactor = 1,
    mobile = false,
    userAgent = null,
    touch = mobile,
  }) {
    await this.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor,
      mobile,
      screenWidth: width,
      screenHeight: height,
    });
    if (userAgent) {
      await this.send("Emulation.setUserAgentOverride", {
        userAgent,
        platform: mobile ? "Linux armv8l" : "Linux x86_64",
      });
    }
    await this.send("Emulation.setTouchEmulationEnabled", {
      enabled: Boolean(touch),
      maxTouchPoints: touch ? 5 : 1,
    });
    await this.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await this.send("Page.bringToFront").catch(() => {});
  }

  async getRect(selector, index = 0) {
    return this.eval(`(() => {
      const nodes = document.querySelectorAll(${JSON.stringify(selector)});
      const el = nodes[${index}];
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) return null;
      return {
        x: r.left,
        y: r.top,
        width: r.width,
        height: r.height,
        cx: r.left + r.width / 2,
        cy: r.top + r.height / 2,
      };
    })()`);
  }

  async clickPoint(x, y, { button = "left", clickCount = 1 } = {}) {
    const buttons = button === "right" ? 2 : 1;
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x,
      y,
      button: "none",
      buttons: 0,
    });
    await this.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button,
      buttons,
      clickCount,
    });
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button,
      buttons: 0,
      clickCount,
    });
  }

  async clickSelector(selector, { index = 0, timeoutMs = 10_000, button = "left" } = {}) {
    const rect = await waitFor(() => this.getRect(selector, index), timeoutMs, `element ${selector}`);
    await this.clickPoint(rect.cx, rect.cy, { button });
    return rect;
  }

  async hoverPoint(x, y) {
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x,
      y,
      button: "none",
      buttons: 0,
    });
  }

  async dragPoints(from, to, { steps = 8, stepDelayMs = 25 } = {}) {
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: from.x,
      y: from.y,
      button: "none",
      buttons: 0,
    });
    await this.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: from.x,
      y: from.y,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      await this.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
        button: "left",
        buttons: 1,
      });
      if (stepDelayMs) await sleep(stepDelayMs);
    }
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: to.x,
      y: to.y,
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
  }

  async tapPoint(x, y) {
    const pt = { x: Math.round(x), y: Math.round(y), radiusX: 12, radiusY: 12, force: 1, id: 1 };
    await this.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [pt] });
    await sleep(40);
    await this.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }

  async tapSelector(selector, { index = 0, timeoutMs = 10_000 } = {}) {
    const rect = await waitFor(() => this.getRect(selector, index), timeoutMs, `touch target ${selector}`);
    await this.tapPoint(rect.cx, rect.cy);
    return rect;
  }

  async touchScroll(x, y, deltaY, steps = 6) {
    const startPt = { x: Math.round(x), y: Math.round(y), radiusX: 12, radiusY: 12, force: 1, id: 1 };
    await this.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [startPt] });
    for (let i = 1; i <= steps; i++) {
      const ny = Math.round(y + (deltaY * i) / steps);
      await this.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ ...startPt, y: ny }],
      });
      await sleep(20);
    }
    await this.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }

  async typeText(text) {
    await this.send("Input.insertText", { text });
  }

  async pressKey(key, { code, keyCode, modifiers = 0 } = {}) {
    const resolvedKeyCode = keyCode ?? key.toUpperCase().charCodeAt(0);
    const resolvedCode = code ?? (key.length === 1 ? `Key${key.toUpperCase()}` : key);
    await this.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key,
      code: resolvedCode,
      modifiers,
      windowsVirtualKeyCode: resolvedKeyCode,
      nativeVirtualKeyCode: resolvedKeyCode,
    });
    await this.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key,
      code: resolvedCode,
      modifiers,
      windowsVirtualKeyCode: resolvedKeyCode,
      nativeVirtualKeyCode: resolvedKeyCode,
    });
  }

  async captureViewport(filePath) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const shot = await this.send("Page.captureScreenshot", { format: "png" });
    const buf = Buffer.from(shot.data, "base64");
    await fs.writeFile(filePath, buf);
    return filePath;
  }

  async captureElement(selector, filePath, { index = 0, padding = 16, scale = 2 } = {}) {
    const rect = await this.getRect(selector, index);
    if (!rect) throw new Error(`Cannot capture missing element: ${selector}`);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const clip = {
      x: Math.max(0, rect.x - padding),
      y: Math.max(0, rect.y - padding),
      width: Math.max(1, rect.width + padding * 2),
      height: Math.max(1, rect.height + padding * 2),
      scale,
    };
    const shot = await this.send("Page.captureScreenshot", { format: "png", clip });
    await fs.writeFile(filePath, Buffer.from(shot.data, "base64"));
    return filePath;
  }

  snapshotErrors() {
    return {
      consoleErrors: [...this.consoleErrors],
      exceptions: [...this.exceptions],
    };
  }

  close() {
    try {
      this.ws.close();
    } catch {
      // Ignore close errors.
    }
  }
}
