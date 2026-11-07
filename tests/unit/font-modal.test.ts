// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { FontPickerModal } from "../../src/fonts/modal";
import type { FontRecord } from "../../src/fonts/css";

const record: FontRecord = {
  id: "gothic",
  family: "Noto Sans Gothic",
  displayName: "Noto Sans Gothic",
  nickname: "gothic",
  className: "langscape-font-gothic",
  source: "vault",
  path: "Fonts/gothic.ttf",
};

const manager = {
  list: () => [record],
  sampleFor: () => "𐌰𐍆𐌰",
} as any;

describe("FontPickerModal", () => {
  it("lists fonts with previews and inserts a span", () => {
    const onChoose = vi.fn();
    const modal = new FontPickerModal({} as any, { manager, onChoose });
    modal.open();
    expect(modal.contentEl.querySelector(".langscape-font-row")).toBeTruthy();
    expect(modal.contentEl.querySelector(".langscape-font-preview")?.textContent).toBe("𐌰𐍆𐌰");
    expect(modal.contentEl.querySelector(".langscape-font-nickname")?.textContent).toContain("gothic");
    (modal.contentEl.querySelector(".langscape-font-row button") as HTMLButtonElement).click();
    expect(onChoose).toHaveBeenCalledWith("{gothic: text}", record);
  });

  it("uses the selected text when provided", () => {
    const onChoose = vi.fn();
    const modal = new FontPickerModal({} as any, {
      manager,
      initialText: "hello",
      onChoose,
    });
    modal.open();
    (modal.contentEl.querySelector(".langscape-font-row button") as HTMLButtonElement).click();
    expect(onChoose).toHaveBeenCalledWith("{gothic: hello}", record);
  });
});
