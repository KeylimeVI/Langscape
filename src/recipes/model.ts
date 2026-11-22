export interface Recipe {
  inputFolder: string | null;
  property: string;
  target?: "title";
  changes: { path: string; disabledRules: string[] }[];
  outputFolder: string | null;
}

export const EMPTY_RECIPE: Recipe = {
  inputFolder: null,
  property: "",
  changes: [],
  outputFolder: null,
};

export function readRecipe(source: string): Recipe {
  const json = source.replace(/^\uFEFF/, "");
  if (!json.trim()) return { ...EMPTY_RECIPE, changes: [] };
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (error) {
    throw new Error(`Invalid recipe JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isObject(data)) throw new Error("Invalid recipe: expected a JSON object.");
  const { inputFolder, property, target, changes, outputFolder } = data;
  if (target !== undefined && target !== "title") throw new Error('Invalid recipe: target must be "title" if set.');
  if (!isFolder(inputFolder) || !isFolder(outputFolder)) {
    throw new Error('Invalid recipe: inputFolder and outputFolder must be paths ("/" for the vault root) or null.');
  }
  if (typeof property !== "string") throw new Error("Invalid recipe: property must be text.");
  if (!Array.isArray(changes)) throw new Error("Invalid recipe: changes must be an array.");
  return {
    inputFolder,
    property,
    ...(target ? { target } : {}),
    changes: changes.map((change, index) => {
      if (!isObject(change) || !nonblank(change.path) || !Array.isArray(change.disabledRules) ||
          !change.disabledRules.every(nonblank)) {
        throw new Error(`Invalid recipe: change ${index + 1} needs a file path and a disabledRules array of rule names.`);
      }
      return { path: change.path, disabledRules: change.disabledRules };
    }),
    outputFolder,
  };
}

export function serializeRecipe(recipe: Recipe): string {
  const { inputFolder, property, target, changes, outputFolder } = recipe;
  return JSON.stringify({
    inputFolder,
    property,
    ...(target ? { target } : {}),
    changes: changes.map(({ path, disabledRules }) => ({ path, disabledRules })),
    outputFolder,
  }, null, 2) + "\n";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonblank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length !== 0;
}

function isFolder(value: unknown): value is string | null {
  return value === null || nonblank(value);
}
