#!/usr/bin/env bash
# Purpose: Safely invoke `changeset publish` via `bun run release`.
#
# Authentication modes (in order of preference):
# 1. OIDC Trusted Publishing (recommended) - npm 11.6+ (Node 24) auto-detects OIDC from GitHub Actions
#    when `id-token: write` permission is set and trusted publisher is configured on npmjs.com.
#    No NPM_TOKEN needed!
# 2. NPM_TOKEN fallback - for bootstrap (first publish) or if OIDC isn't configured yet.
#
# This prevents the Changesets workflow from failing on main for repositories that haven't
# configured publishing yet.

set -euo pipefail

annotate() {
  local level="$1" # notice|warning
  local msg="$2"
  case "$level" in
    warning) echo "::warning::${msg}" ;;
    *) echo "::notice::${msg}" ;;
  esac
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    {
      echo "## Changesets Publish"
      echo "${msg}"
    } >>"$GITHUB_STEP_SUMMARY"
  fi
}

list_publishable_packages() {
  node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const rootPackage = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const workspacePatterns = Array.isArray(rootPackage.workspaces)
  ? rootPackage.workspaces
  : rootPackage.workspaces?.packages ?? [];

if (!rootPackage.private && rootPackage.name) {
  console.log(rootPackage.name);
}

for (const pattern of workspacePatterns) {
  if (pattern !== 'packages/*') continue;
  for (const entry of fs.readdirSync('packages', { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packageJsonPath = path.join('packages', entry.name, 'package.json');
    if (!fs.existsSync(packageJsonPath)) continue;
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    if (pkg.private || !pkg.name) continue;
    console.log(pkg.name);
  }
}
NODE
}

# Check if pre-release mode is active
if [[ -f .changeset/pre.json ]]; then
  annotate notice "Pre-release mode is active. Skipping automated publish from main (use pre-release publishing workflow instead)."
  exit 0
fi

# Determine auth mode
if [[ -n "${NPM_TOKEN:-}" ]]; then
  # Fallback: use NPM_TOKEN (for bootstrap or if OIDC not configured)
  annotate notice "NPM_TOKEN detected; using token auth (fallback mode)."

  # Determine which .npmrc to write to. setup-node sets NPM_CONFIG_USERCONFIG
  # to a temp file that overrides ~/.npmrc, so we must write there if it exists.
  NPMRC="${NPM_CONFIG_USERCONFIG:-$HOME/.npmrc}"

  # Trap to ensure cleanup on exit
  trap 'rm -f "$NPMRC"' EXIT

  # Authenticate npm for publish
  {
    echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}"
  } > "$NPMRC"
  chmod 0600 "$NPMRC"

  echo "::group::Configure npm auth"
  echo "Wrote npm auth token to ${NPMRC}"
  echo "::endgroup::"
else
  # Primary: OIDC trusted publishing (no token needed)
  # npm CLI auto-detects OIDC from GitHub Actions when id-token: write is set
  annotate notice "No NPM_TOKEN; relying on OIDC trusted publishing."
  annotate notice "Ensure trusted publisher is configured at: npmjs.com → package Settings → Trusted Publisher"

  # First publish still needs bootstrap credentials. If any publishable package
  # does not exist on npm yet, skip instead of leaving main red.
  unpublished_packages=()
  while IFS= read -r package_name; do
    [[ -z "$package_name" ]] && continue

    npm_error_file="$(mktemp)"
    if npm view "$package_name" version --json > /dev/null 2>"$npm_error_file"; then
      rm -f "$npm_error_file"
      continue
    fi

    if grep -Eq 'E404|404 Not Found' "$npm_error_file"; then
      unpublished_packages+=("$package_name")
      rm -f "$npm_error_file"
      continue
    fi

    annotate warning "Unable to determine npm publish status for ${package_name}; continuing with publish attempt."
    cat "$npm_error_file" >&2 || true
    rm -f "$npm_error_file"
  done < <(list_publishable_packages)

  if [[ "${#unpublished_packages[@]}" -gt 0 ]]; then
    annotate warning "Skipping publish because first publish still requires NPM_TOKEN for: ${unpublished_packages[*]}"
    exit 0
  fi
fi

annotate notice "Building before publish..."
bun run build

annotate notice "Attempting publish via 'bun run release'."

# Run the project's publish script (configured to call `changeset publish`)
bun run release
