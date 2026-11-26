# Langscape Agent Instructions

## Git & Branch Workflow

- **Always push to `beta` whenever you make any change.**
  - Do your work on the `beta` branch (fast-forwarding `beta` from `main` first if `beta` is behind `main`).
  - After verifying your changes, commit them on `beta` and push to `origin/beta` (`git push origin beta`).
  - Do not leave changes uncommitted or only on `main`. (`main` is reserved for releases and GitHub Pages deploys.)

## Safe Vault Traversal (Avoid `Obsidian Vault/Obsidian Vault/...` Loops)

- **Never call `app.vault.getFiles()` directly** (or recursively walk `TFolder.children` without symlink/nested-vault guards) when listing files or folders in a vault.
- **Always use the shared helpers in `src/utils/vault.ts`**:
  - `listVaultFiles(vault, filter?)`
  - `listVaultFolders(vault)`
  - `getVaultDisk(vault)`
- **Why**: Some user vaults contain a symlink or Windows junction pointing back to the vault root (e.g., `Obsidian Vault/Obsidian Vault/...`) or contain nested Obsidian vaults (subdirectories with `.obsidian` / `vault.configDir`). Calling `vault.getFiles()` directly exposes repeated paths indefinitely and causes files (fonts, recipes, `.lsc` scripts, etc.) to be duplicated endlessly.
- `src/utils/vault.ts` (with lazy desktop-only fs access via `src/utils/vault-disk.ts`) stops at symlinks/junctions (`lstat`), tracks visited `realpath`s to break directory cycles, skips nested vaults, and falls back to `vault.adapter.stat` on mobile without eager Node `require` calls.

## Verification

- Run `npm run verify` (`tsc --noEmit`, `esbuild` bundle, and unit tests) before committing and pushing to `beta`.
