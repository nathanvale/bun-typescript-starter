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

# Check if pre-release mode is active
if [[ -f .changeset/pre.json ]]; then
  annotate notice "Pre-release mode is active. Skipping automated publish from main (use pre-release publishing workflow instead)."
  exit 0
fi

# Determine auth mode
if [[ -n "${NPM_TOKEN:-}" ]]; then
  # Fallback: use NPM_TOKEN (for bootstrap or if OIDC not configured)
  annotate notice "NPM_TOKEN detected; using token auth (fallback mode)."

  # Trap to ensure cleanup on exit
  trap 'rm -f "$HOME/.npmrc"' EXIT

  # Authenticate npm for publish
  {
    echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}"
  } > "$HOME/.npmrc"
  chmod 0600 "$HOME/.npmrc"

  echo "::group::Configure npm auth"
  echo "Wrote npm auth token to ~/.npmrc"
  echo "::endgroup::"
else
  # Primary: OIDC trusted publishing (no token needed)
  # npm CLI auto-detects OIDC from GitHub Actions when id-token: write is set
  annotate notice "No NPM_TOKEN; relying on OIDC trusted publishing."
  annotate notice "Ensure trusted publisher is configured at: npmjs.com → package Settings → Trusted Publisher"
fi

annotate notice "Attempting publish via 'bun run release'."

# Run the project's publish script (configured to call `changeset publish`)
bun run release
