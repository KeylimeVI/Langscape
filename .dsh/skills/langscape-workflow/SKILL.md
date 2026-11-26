---
name: langscape-workflow
description: Required Langscape repo conventions: always commit and push changes to the beta branch, and always use src/utils/vault.ts instead of vault.getFiles() to avoid recursive Obsidian Vault/ symlink loops.
---

# Langscape Workflow & Vault Safety

Follow these two standing rules on every task in this repository.

## 1. Always Push Changes to `beta`

- Whenever you make any code, docs, test, or config change in this repo, commit it to the `beta` branch and push to `origin/beta`.
- If `beta` is behind `main`, fast-forward `beta` to `main` first (`git merge-base --is-ancestor beta main && git branch -f beta main && git checkout beta`) before committing.
- Never finish a change leaving edits uncommitted or only on `main`.

## 2. Safe Vault File & Folder Enumeration

- **Never** call `app.vault.getFiles()` directly or traverse `TFolder.children` naively.
- **Always** use `listVaultFiles()`, `listVaultFolders()`, and `getVaultDisk()` from `src/utils/vault.ts`.
- **Root cause of the recurring bug**: User vaults with a symlink/Windows junction pointing back to the vault root (or containing nested `.obsidian` vaults) cause Obsidian's `vault.getFiles()` to emit infinitely repeated paths like `Obsidian Vault/Obsidian Vault/...`. This previously broke recipe pickers and `FontManager.refresh()`.
- `src/utils/vault.ts` prevents this on both desktop (via lazy `node:fs/promises` `lstat` + `realpath` cycle detection in `src/utils/vault-disk.ts`) and mobile (via `vault.adapter.stat` nested-vault checks, with no eager Node imports).
- When adding any new vault file/folder picker or scanner, use `src/utils/vault.ts` and add a unit test covering symlink loops and nested vaults.

## 3. Before Pushing

- Run `npm run verify` (`tsc --noEmit`, `esbuild`, and Vitest unit tests) and ensure it passes before pushing to `origin/beta`.
