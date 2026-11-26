import { Notice, TFolder, normalizePath } from "obsidian";
import { LEXURGY_DOCS_VIEW_TYPE, LexurgyDocsView } from "./lexurgy/docs-view";
import { LexurgyService } from "./lexurgy/service";
import type LangscapePlugin from "./main";
import { EMPTY_RECIPE, serializeRecipe } from "./recipes/model";
import { RECIPE_VIEW_TYPE, RecipeView } from "./recipes/view";
import { NEW_LSC_TEMPLATE } from "./soundchange/template";
import { SOUNDCHANGE_VIEW_TYPE, SoundChangeView } from "./soundchange/view";

export function registerDesktopFeatures(plugin: LangscapePlugin): LexurgyService {
  const lexurgy = new LexurgyService(plugin);
  plugin.registerView(SOUNDCHANGE_VIEW_TYPE, (leaf) => new SoundChangeView(leaf, plugin, lexurgy));
  plugin.registerView(LEXURGY_DOCS_VIEW_TYPE, (leaf) => new LexurgyDocsView(leaf));
  plugin.registerExtensions(["lsc"], SOUNDCHANGE_VIEW_TYPE);
  plugin.registerView(RECIPE_VIEW_TYPE, (leaf) => new RecipeView(leaf, lexurgy));
  plugin.registerExtensions(["recipe"], RECIPE_VIEW_TYPE);

  const { vault, workspace } = plugin.app;
  const createFile = async (folder: TFolder | null | undefined, name: string, extension: string, content: string) => {
    const base = normalizePath(folder && !folder.isRoot() ? `${folder.path}/${name}` : name);
    let path = `${base}.${extension}`;
    let index = 2;
    while (vault.getAbstractFileByPath(path)) path = `${base} ${index++}.${extension}`;
    try {
      const file = await vault.create(path, content);
      await workspace.getLeaf("tab").openFile(file);
    } catch (error) {
      new Notice(`Could not create .${extension} file: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const createSoundChangeFile = (folder = workspace.getActiveFile()?.parent) =>
    createFile(folder, "Sound Changes", "lsc", NEW_LSC_TEMPLATE);
  const createRecipeFile = (folder = workspace.getActiveFile()?.parent) =>
    createFile(folder, "Recipe", "recipe", serializeRecipe(EMPTY_RECIPE));

  plugin.addCommand({
    id: "create-sound-change-file",
    name: "Create sound-change file",
    callback: () => void createSoundChangeFile(),
  });
  plugin.addCommand({
    id: "create-recipe",
    name: "Create recipe",
    callback: () => void createRecipeFile(),
  });
  // Obsidian passes the vault root for a right-click on blank explorer space.
  plugin.registerEvent(workspace.on("file-menu", (menu, file, source) => {
    if (source !== "file-explorer-context-menu" || !(file instanceof TFolder)) return;
    menu.addItem((item) => item.setTitle("New Lexurgy file").setIcon("languages")
      .setSection("action-primary").onClick(() => void createSoundChangeFile(file)));
    menu.addItem((item) => item.setTitle("New recipe").setIcon("book-open")
      .setSection("action-primary").onClick(() => void createRecipeFile(file)));
  }));

  const probe = window.setTimeout(() => void lexurgy.getEnvironment().catch(() => undefined), 1500);
  plugin.register(() => {
    window.clearTimeout(probe);
    void lexurgy.dispose();
  });
  return lexurgy;
}
