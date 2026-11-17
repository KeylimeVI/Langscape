#!/usr/bin/env bash
#
# Install the newest Langscape build from the homelab into an Obsidian vault.
#
# The default source is the build artifact published to GitHub by the homelab:
#   https://github.com/KeylimeVI/Langscape/blob/main/dist/langscape-*.zip
#
# The homelab can also be read directly over Tailscale/SSH:
#   ./install-from-homelab.sh --source ssh --host keylime@homelab
#   ./install-from-homelab.sh --source ssh --host keylime@homelab --remote-build
#
# Runtime state is preserved by default:
#   - data.json
#   - lexurgy/ (the managed Lexurgy installation)
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/KeylimeVI/Langscape/main/scripts/install-from-homelab.sh | bash
#   ./install-from-homelab.sh --dry-run
#   ./install-from-homelab.sh --vault "$HOME/Documents/Obsidian Vault"
#   ./install-from-homelab.sh --source url --url https://example.com/langscape.zip
#   ./install-from-homelab.sh --source file --zip ./dist/langscape-0.1.0.zip
#
set -euo pipefail

DEFAULT_VAULT="/home/keylime/Documents/Obsidian Vault"
GITHUB_REPO="${LANGSCAPE_REPO:-KeylimeVI/Langscape}"
GITHUB_REF="${LANGSCAPE_REF:-main}"

SOURCE="${LANGSCAPE_SOURCE:-github}"
VAULT="${OBSIDIAN_VAULT:-$DEFAULT_VAULT}"
ZIP_URL="${LANGSCAPE_ZIP_URL:-}"
ZIP_FILE=""
SSH_HOST="${HOMELAB_HOST:-}"
REMOTE_REPO="${HOMELAB_REPO:-/projects/Langscape}"
# If a homelab SSH target is configured, read from it directly by default.
if [ -z "${LANGSCAPE_SOURCE:-}" ] && [ -n "$SSH_HOST" ]; then
  SOURCE="ssh"
fi
REMOTE_BUILD=0
PRESERVE=1
DRY_RUN=0

usage() {
  cat <<'EOF'
Install the newest Langscape build into an Obsidian vault.

Options:
  --vault <path>        Vault path (default: /home/keylime/Documents/Obsidian Vault)
  --source <kind>       github (default), url, file, or ssh
  --url <url>           Zip URL for --source url
  --zip <path>          Zip file for --source file
  --host <user@host>    SSH/Tailscale target for --source ssh
  --remote-repo <path>  Langscape checkout on the homelab (default: /projects/Langscape)
  --remote-build        Build/package on the homelab before copying (--source ssh)
  --no-preserve         Do not carry over data.json / lexurgy/
  --dry-run             Show the plan without changing anything
  --help                Show this help

Environment:
  OBSIDIAN_VAULT        Default vault path
  HOMELAB_HOST          Default SSH target
  HOMELAB_REPO          Default remote checkout path
  LANGSCAPE_REPO        GitHub owner/repo (default: KeylimeVI/Langscape)
  LANGSCAPE_REF         Git ref/branch (default: main)
  LANGSCAPE_ZIP_URL     Default zip URL for --source url
  LANGSCAPE_SOURCE      Default source kind (default: github)
  GITHUB_TOKEN          Optional token for private repos / API rate limits

Examples:
  ./install-from-homelab.sh
  ./install-from-homelab.sh --source ssh --host keylime@homelab
  ./install-from-homelab.sh --source ssh --host keylime@homelab --remote-build
  ./install-from-homelab.sh --source file --zip ./dist/langscape-0.1.0.zip
EOF
}

die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

require() {
  command -v "$1" >/dev/null 2>&1 || die "Missing '$1'. Install it with: sudo dnf install $2"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --vault) [ "$#" -ge 2 ] || die "--vault requires a path"; VAULT="$2"; shift 2 ;;
    --vault=*) VAULT="${1#*=}"; shift ;;
    --source) [ "$#" -ge 2 ] || die "--source requires a value"; SOURCE="$2"; shift 2 ;;
    --source=*) SOURCE="${1#*=}"; shift ;;
    --url) [ "$#" -ge 2 ] || die "--url requires a URL"; ZIP_URL="$2"; SOURCE="url"; shift 2 ;;
    --url=*) ZIP_URL="${1#*=}"; SOURCE="url"; shift ;;
    --zip) [ "$#" -ge 2 ] || die "--zip requires a path"; ZIP_FILE="$2"; SOURCE="file"; shift 2 ;;
    --zip=*) ZIP_FILE="${1#*=}"; SOURCE="file"; shift ;;
    --host) [ "$#" -ge 2 ] || die "--host requires user@host"; SSH_HOST="$2"; shift 2 ;;
    --host=*) SSH_HOST="${1#*=}"; shift ;;
    --remote-repo) [ "$#" -ge 2 ] || die "--remote-repo requires a path"; REMOTE_REPO="$2"; shift 2 ;;
    --remote-repo=*) REMOTE_REPO="${1#*=}"; shift ;;
    --remote-build) REMOTE_BUILD=1; shift ;;
    --no-preserve) PRESERVE=0; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    *) die "Unknown option: $1 (try --help)" ;;
  esac
done

case "$SOURCE" in
  github|url|file|ssh) ;;
  *) die "--source must be github, url, file, or ssh" ;;
esac

VAULT="${VAULT%/}"
PLUGINS_DIR="$VAULT/.obsidian/plugins"
DESTINATION="$PLUGINS_DIR/langscape"
COMMUNITY_PLUGINS="$VAULT/.obsidian/community-plugins.json"

require unzip unzip
if [ "$SOURCE" = "github" ] || [ "$SOURCE" = "url" ]; then
  require curl curl
fi
if [ "$SOURCE" = "ssh" ]; then
  require ssh openssh-clients
  require scp openssh-clients
  [ -n "$SSH_HOST" ] || die "--source ssh needs --host or HOMELAB_HOST"
fi

[ -d "$VAULT" ] || die "Vault does not exist: $VAULT"
[ -d "$PLUGINS_DIR" ] || die "Not an Obsidian vault (missing .obsidian/plugins): $VAULT"

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/langscape-install.XXXXXX")"
STAGING=""
BACKUP=""
cleanup() {
  if [ -n "$BACKUP" ] && [ -d "$BACKUP" ]; then
    if [ ! -d "$DESTINATION" ]; then
      mv "$BACKUP" "$DESTINATION" 2>/dev/null || true
    else
      rm -rf "$BACKUP"
    fi
  fi
  [ -n "$STAGING" ] && rm -rf "$STAGING"
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

ZIP="$TMP_DIR/langscape.zip"

latest_github_zip() {
  local api="https://api.github.com/repos/$GITHUB_REPO/contents/dist?ref=$GITHUB_REF"
  local json=""
  local download=""
  local version=""
  local headers=(-H "Accept: application/vnd.github+json")
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    headers+=(-H "Authorization: Bearer $GITHUB_TOKEN")
  fi

  if json="$(curl -fsSL "${headers[@]}" "$api" 2>/dev/null)"; then
    download="$(printf '%s' "$json" \
      | grep -o '"download_url"[[:space:]]*:[[:space:]]*"[^"]*"' \
      | sed -E 's/.*"([^"]+)"$/\1/' \
      | grep -E '/dist/langscape-[^/]+\.zip$' \
      | sort -V \
      | tail -1 || true)"
    if [ -n "$download" ]; then
      printf '%s\n' "$download"
      return 0
    fi
  fi

  # Fallback for API rate limits: use the version from manifest.json.
  version="$(curl -fsSL "https://raw.githubusercontent.com/$GITHUB_REPO/$GITHUB_REF/manifest.json" 2>/dev/null \
    | tr -d '\r\n' \
    | sed -nE 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' || true)"
  [ -n "$version" ] || return 1
  printf 'https://raw.githubusercontent.com/%s/%s/dist/langscape-%s.zip\n' \
    "$GITHUB_REPO" "$GITHUB_REF" "$version"
}

case "$SOURCE" in
  github)
    ZIP_URL="$(latest_github_zip)" || die "Could not find a Langscape build in $GITHUB_REPO/$GITHUB_REF/dist"
    ;;
  url)
    [ -n "$ZIP_URL" ] || die "--source url needs --url or LANGSCAPE_ZIP_URL"
    ;;
  file)
    [ -n "$ZIP_FILE" ] || die "--source file needs --zip"
    [ -f "$ZIP_FILE" ] || die "Zip not found: $ZIP_FILE"
    ZIP="$ZIP_FILE"
    ;;
esac

printf 'Source: %s\n' "$SOURCE"
if [ "$SOURCE" = "ssh" ]; then
  remote_zip=""
  if [ "$REMOTE_BUILD" -eq 1 ]; then
    printf 'Building on %s:%s ...\n' "$SSH_HOST" "$REMOTE_REPO"
    # shellcheck disable=SC2029  # remote path is quoted with printf %q
    if ! remote_zip="$(ssh "$SSH_HOST" \
      "cd $(printf '%q' "$REMOTE_REPO") && npm run build && npm run package:release && ls -1t $(printf '%q' "$REMOTE_REPO")/dist/langscape-*.zip | head -1")"; then
      die "Remote build failed on $SSH_HOST:$REMOTE_REPO"
    fi
  else
    # shellcheck disable=SC2029  # remote path is quoted with printf %q
    if ! remote_zip="$(ssh "$SSH_HOST" \
      "ls -1t $(printf '%q' "$REMOTE_REPO")/dist/langscape-*.zip 2>/dev/null | head -1")"; then
      die "Could not read $SSH_HOST:$REMOTE_REPO/dist"
    fi
  fi
  [ -n "$remote_zip" ] || die "No langscape-*.zip found on $SSH_HOST:$REMOTE_REPO/dist"
  printf 'Remote build: %s\n' "$remote_zip"
  scp -q "$SSH_HOST:$remote_zip" "$ZIP" || die "Could not copy $SSH_HOST:$remote_zip"
elif [ "$SOURCE" = "file" ]; then
  printf 'Build: %s\n' "$ZIP_FILE"
else
  printf 'Build: %s\n' "$ZIP_URL"
  curl -fL --retry 3 --connect-timeout 15 -o "$ZIP" "$ZIP_URL" \
    || die "Could not download $ZIP_URL"
fi

ENTRIES="$(unzip -Z1 "$ZIP")"
for required in main.js manifest.json styles.css; do
  printf '%s\n' "$ENTRIES" | grep -qx "$required" || die "Zip is missing $required"
done
if printf '%s\n' "$ENTRIES" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
  die "Zip contains an unsafe absolute or parent path"
fi

MANIFEST="$(unzip -p "$ZIP" manifest.json | tr -d '\r\n')"
PLUGIN_ID="$(printf '%s' "$MANIFEST" | sed -nE 's/.*"id"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p')"
VERSION="$(printf '%s' "$MANIFEST" | sed -nE 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p')"
[ "$PLUGIN_ID" = "langscape" ] || die "Unexpected plugin id \"$PLUGIN_ID\""

shopt -s nullglob
runtime_source=""
for candidate in "$DESTINATION" "$PLUGINS_DIR"/langscape-*/; do
  [ -d "$candidate" ] || continue
  if [ -f "$candidate/data.json" ] || [ -d "$candidate/lexurgy" ]; then
    runtime_source="${candidate%/}"
    break
  fi
done

old_dirs=()
old_zips=()
for path in "$PLUGINS_DIR"/langscape "$PLUGINS_DIR"/langscape-*; do
  if [ -d "$path" ]; then
    old_dirs+=("$path")
  elif [ -f "$path" ] && [[ "$path" == *.zip ]]; then
    old_zips+=("$path")
  fi
done

printf 'Vault: %s\n' "$VAULT"
printf 'Install: %s -> %s\n' "$VERSION" "$DESTINATION"
if [ "$PRESERVE" -eq 1 ] && [ -n "$runtime_source" ]; then
  printf 'Preserve: data.json / lexurgy/ from %s\n' "$runtime_source"
fi
for path in "${old_dirs[@]}" "${old_zips[@]}"; do
  printf 'Remove: %s\n' "$path"
done

if [ "$DRY_RUN" -eq 1 ]; then
  printf 'Dry run: no files changed.\n'
  exit 0
fi

STAGING="$(mktemp -d "$PLUGINS_DIR/.langscape-install.XXXXXX")"
unzip -q "$ZIP" -d "$STAGING"

if [ "$PRESERVE" -eq 1 ] && [ -n "$runtime_source" ]; then
  if [ -f "$runtime_source/data.json" ]; then
    cp -p "$runtime_source/data.json" "$STAGING/data.json"
    printf 'Preserved data.json\n'
  fi
  if [ -d "$runtime_source/lexurgy" ]; then
    cp -a "$runtime_source/lexurgy" "$STAGING/lexurgy"
    printf 'Preserved lexurgy/\n'
  fi
fi

# Move the current install aside so a failed move cannot destroy it.
if [ -d "$DESTINATION" ]; then
  BACKUP="$PLUGINS_DIR/.langscape-old.$$"
  mv "$DESTINATION" "$BACKUP"
fi
if ! mv "$STAGING" "$DESTINATION"; then
  if [ -n "$BACKUP" ]; then
    mv "$BACKUP" "$DESTINATION" 2>/dev/null || true
    BACKUP=""
  fi
  die "Could not move the new build into place"
fi
STAGING=""
if [ -n "$BACKUP" ]; then
  rm -rf "$BACKUP"
  BACKUP=""
fi

# Remove older versioned plugin folders and zips now that the new one is live.
for path in "${old_dirs[@]}"; do
  [ "$path" = "$DESTINATION" ] && continue
  rm -rf "$path"
  printf 'Removed %s\n' "$path"
done
for path in "${old_zips[@]}"; do
  rm -f "$path"
  printf 'Removed %s\n' "$path"
done

# Keep the plugin enabled. Obsidian already has "langscape" here after the
# first install; only touch the file when it is missing the entry.
if [ -f "$COMMUNITY_PLUGINS" ]; then
  if ! grep -q '"langscape"' "$COMMUNITY_PLUGINS"; then
    if command -v jq >/dev/null 2>&1; then
      if jq 'if index("langscape") then . else . + ["langscape"] end' \
        "$COMMUNITY_PLUGINS" > "$COMMUNITY_PLUGINS.tmp" \
        && mv "$COMMUNITY_PLUGINS.tmp" "$COMMUNITY_PLUGINS"; then
        printf 'Enabled langscape in community-plugins.json\n'
      else
        rm -f "$COMMUNITY_PLUGINS.tmp"
        printf 'Warning: add "langscape" to %s (or enable it in Obsidian).\n' "$COMMUNITY_PLUGINS"
      fi
    else
      printf 'Warning: add "langscape" to %s (or enable it in Obsidian).\n' "$COMMUNITY_PLUGINS"
    fi
  fi
else
  printf 'Warning: %s is missing; enable Langscape in Obsidian.\n' "$COMMUNITY_PLUGINS"
fi

obsidian_running=0
if command -v ps >/dev/null 2>&1; then
  if ps -u "$(id -u)" -o stat=,comm= 2>/dev/null \
    | awk 'tolower($2) ~ /obsidian/ && $1 !~ /^Z/ { found=1 } END { exit found ? 0 : 1 }'; then
    obsidian_running=1
  fi
fi

if [ "$obsidian_running" -eq 1 ]; then
  printf '\nObsidian is running. Reload it (or disable/enable Langscape) to load %s.\n' "$VERSION"
else
  printf '\nDone. Start Obsidian to load %s.\n' "$VERSION"
fi
