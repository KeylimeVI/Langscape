/**
 * Update one or more keys in the first ```langscape block of a canvas text
 * card while preserving the rest of the card's markdown.
 */
export function updatePipelineBlock(
  source: string,
  patch: Record<string, string | undefined>
): string {
  const match = /(```langscape[^\n]*\n)([\s\S]*?)(```)/.exec(source);
  if (!match) return source;
  const lines = match[2].replace(/\s+$/, "").split(/\r?\n/);
  for (const [key, value] of Object.entries(patch)) {
    const index = lines.findIndex((line) =>
      new RegExp(`^\\s*${escapeRegExp(key)}\\s*:`).test(line)
    );
    const clean = value?.trim();
    if (!clean) {
      if (index >= 0) lines.splice(index, 1);
      continue;
    }
    const rendered = `${key}: ${yamlValue(clean)}`;
    if (index >= 0) lines[index] = rendered;
    else lines.push(rendered);
  }
  const body = lines.filter((line) => line.length > 0).join("\n");
  return (
    source.slice(0, match.index) +
    match[1] +
    body +
    "\n" +
    match[3] +
    source.slice(match.index + match[0].length)
  );
}

function yamlValue(value: string): string {
  return /^[A-Za-z0-9_./ -]+$/.test(value) && !/^[-?:,[\]{}#&*!|>'"%@`]/.test(value)
    ? value
    : JSON.stringify(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
