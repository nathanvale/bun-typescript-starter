#!/usr/bin/env bash
# Perform an alpha snapshot version and publish.
#
# Authentication modes:
# 1. OIDC trusted publishing when NPM_TOKEN is absent
# 2. NPM_TOKEN fallback for bootstrap or repos without trusted publishing

set -euo pipefail

annotate() {
	local level="${1:-notice}" # notice|warning
	local msg="${2:-}"
	case "$level" in
		warning) echo "::warning::${msg}" ;;
		*) echo "::notice::${msg}" ;;
	esac
	if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
		{
			echo "## Alpha Snapshot Publish"
			echo "${msg}"
		} >>"$GITHUB_STEP_SUMMARY"
	fi
}

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
	missing=()
	[[ -z "${GITHUB_TOKEN:-}" ]] && missing+=("GITHUB_TOKEN")
	annotate warning "Missing required secrets: ${missing[*]}. Skipping alpha snapshot publish."
	exit 0
fi

# Check if pre-release mode is active
if [[ -f .changeset/pre.json ]]; then
	annotate notice "Pre-release mode is active. Skipping alpha snapshot (use pre-release versioning instead)."
	exit 0
fi

if [[ -n "${NPM_TOKEN:-}" ]]; then
	NPMRC="${NPM_CONFIG_USERCONFIG:-$HOME/.npmrc}"
	trap 'rm -f "$NPMRC"' EXIT
	{
		echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}"
	} > "$NPMRC"
	chmod 0600 "$NPMRC"
	annotate notice "NPM_TOKEN detected; using token auth (fallback mode)."
else
	annotate notice "No NPM_TOKEN; relying on OIDC trusted publishing."
	annotate notice "Ensure trusted publisher is configured at: npmjs.com → package Settings → Trusted Publisher"
fi

# Configure git identity and disable hooks for automation
git config user.name 'github-actions[bot]'
git config user.email 'github-actions[bot]@users.noreply.github.com'
export HUSKY=0
git config --global core.hooksPath /dev/null || true

annotate notice "Publishing alpha snapshot via Changesets (version snapshot + npm publish)."

bunx changeset version --snapshot alpha
bunx changeset publish --tag alpha
