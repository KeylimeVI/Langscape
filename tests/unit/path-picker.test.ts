// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { pickPath } from "../../src/ui/path-picker";

const options = [
  { path: "Words/Proto", kind: "folder" as const },
  { path: "Words/Modern", kind: "folder" as const },
];

afterEach(() => {
  document.body.empty();
});

describe("path popover", () => {
  it("chooses an existing folder", async () => {
    const promise = pickPath(
      {} as any,
      { title: "Choose", placeholder: "Search folders", options }
    );
    const rows = document.querySelectorAll(".langscape-path-item");
    expect(rows).toHaveLength(2);
    (rows[0] as HTMLButtonElement).click();
    await expect(promise).resolves.toBe("Words/Proto");
  });

  it("filters the list as you type", () => {
    pickPath({} as any, { title: "Choose", placeholder: "Search", options });
    const input = document.querySelector(".langscape-path-search") as HTMLInputElement;
    input.value = "modern";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const rows = document.querySelectorAll(".langscape-path-item");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("Words/Modern");
  });

  it("offers to create a typed new folder when allowed", async () => {
    const promise = pickPath({} as any, {
      title: "Choose",
      placeholder: "Search",
      options,
      allowCustom: true,
      initialValue: "Languages/Modern",
    });
    const create = document.querySelector(".langscape-path-item:last-child") as HTMLButtonElement;
    expect(create.textContent).toContain("Create “Languages/Modern”");
    create.click();
    await expect(promise).resolves.toBe("Languages/Modern");
  });
});
