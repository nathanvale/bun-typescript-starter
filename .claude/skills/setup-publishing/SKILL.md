---
name: setup-publishing
description: Set up npm publishing for a bun-typescript-starter repo. Automates token creation, first publish, OIDC trusted publishing, and GitHub secrets via Chrome DevTools MCP. Use when a new repo needs publishing configured.
argument-hint: "[package-name]"
---

# Setup Publishing

Automate the full npm publishing setup for repos built on `nathanvale/bun-typescript-starter`. Uses Chrome DevTools MCP (`mcp__chrome-devtools__*`) for npm web UI steps that have no CLI equivalent.

**Why Chrome DevTools MCP?** npm uses Cloudflare bot protection that blocks headless browsers (agent-browser). Chrome DevTools MCP connects to the user's real Chrome session via CDP, bypassing bot detection and preserving passkey/fingerprint authentication.

**Prerequisites:** The user must have Chrome open. The Chrome DevTools MCP server must be configured and running.

## Phase 0: Select Target Repo

Before running any checks, determine which repo to set up publishing for.

1. If the user specified a target repo in their invocation arguments, `cd` into it and skip to Phase 0.5.
2. Otherwise, present this simple choice:

```
What do you want to publish?

1. This repo (bun-typescript-starter)
2. A downstream repo created from this template

Choose (1-2):
```

- **Option 1:** Stay in the current directory. Proceed to Phase 0.5.
- **Option 2:** Discover downstream repos inline (do NOT invoke `/find-downstream`):

  **Step 1: Query GitHub API for template-derived repos:**
  ```bash
  gh api graphql -f query='{
    repositoryOwner(login: "nathanvale") {
      repositories(first: 100, orderBy: {field: CREATED_AT, direction: DESC}) {
        nodes {
          name
          templateRepository { nameWithOwner }
        }
      }
    }
  }' --jq '[.data.repositoryOwner.repositories.nodes[] | select(.templateRepository.nameWithOwner == "nathanvale/bun-typescript-starter") | .name]'
  ```

  **Step 2: Filter to locally cloned repos (can't publish what isn't cloned):**
  ```bash
  for name in <repo-names-from-step-1>; do
    [ -d "$HOME/code/$name" ] && echo "$name" || true
  done
  ```

  **Step 3:** Present as a numbered list and ask the user to pick one. After selection, `cd` into `~/code/<selected-repo>`, then proceed to Phase 0.5.

**Wait for the user's choice before proceeding.**

## Phase 0.5: Pre-flight Checks

Check the current state of the **selected repo** -- skip any phase that's already done.

### Step 1: Placeholder gate (run FIRST, alone)

```bash
PACKAGE=$(node -p "require('./package.json').name")
echo "$PACKAGE" | grep -q '{{' && echo "PLACEHOLDER" || echo "OK: $PACKAGE"
```

**If output is `PLACEHOLDER`:**

- **If running on `bun-typescript-starter` itself (the template repo):** This is expected -- the template intentionally uses `{{PACKAGE_NAME}}`. STOP and tell the user: _"This is the template repo -- it uses placeholder package names by design and isn't meant to be published directly. Use Option 2 to set up publishing for a downstream repo instead."_ Return to Phase 0.
- **If running on a downstream repo:** STOP and tell the user to run `bun run setup` first. Do NOT run any further commands -- npm/gh calls with a placeholder name produce noisy errors.

### Step 2: State checks (only after Step 1 passes)

Run these in parallel only after confirming the package name is valid:

```bash
# Already published?
npm view "$PACKAGE" version 2>&1

# Local auth working?
npm whoami 2>&1

# GitHub secrets already set?
gh secret list 2>&1

# Build output exists?
ls dist/ 2>&1
```

**Decision tree based on state:**

| `PACKAGE` | `npm view` | `npm whoami` | Next step |
|-----------|------------|-------------|-----------|
| Contains `{{` | -- | -- | STOP -- if template repo, redirect to Option 2; if downstream, run `bun run setup` first |
| Valid name | E404 (not found) | Works | First publish (Phase 3) |
| Valid name | E404 (not found) | E401 (bad token) | Fix local auth (Phase 1), then first publish |
| Valid name | Returns version | Works | OIDC setup (Phase 4) |
| Valid name | Returns version | E401 | Fix local auth (Phase 1), then OIDC setup |

## Phase 1: Fix Local npm Auth

Only needed if `npm whoami` fails with E401.

```bash
# Check if 1Password has a valid token
op item list --vault="API Credentials" 2>&1 | grep -i npm

# If found, swap it into ~/.npmrc
op read "op://API Credentials/NPM_TOKEN/credential" \
  | xargs -I{} bash -c 'echo "//registry.npmjs.org/:_authToken={}" > ~/.npmrc'

# Verify
npm whoami
```

If no token exists in 1Password, go to Phase 2 to create one.

## Phase 2: Create Granular Access Token (Chrome DevTools MCP)

This step requires the npm web UI -- there is no CLI equivalent for creating granular tokens.

**Ask the user:** _"I need to create an npm granular access token. This requires browser automation to fill out the npm token form. Want me to proceed?"_

If the user declines or Chrome DevTools MCP is unavailable, provide manual instructions (see Fallback section).

### Browser Flow

1. Navigate to the token creation page:
   ```
   mcp__chrome-devtools__navigate_page(type: "url", url: "https://www.npmjs.com/settings/nathanvale/tokens/granular-access-tokens/new")
   ```

2. Take a snapshot to check the page state:
   ```
   mcp__chrome-devtools__take_snapshot()
   ```

3. **If login page appears:** Ask the user to log in manually in Chrome (fingerprint/passkey works here since it's their real browser). Then re-snapshot.

4. **If 2FA page appears:** Ask the user to tap "Use security key" and authenticate with their fingerprint. Then re-snapshot.

5. Fill the form fields using uid refs from the snapshot:
   - **Token name**: `<repo-name>-publish` (e.g., `side-quest-core-publish`)
   - **Expiration**: 90 days (max for write tokens)
   - **Packages and scopes**: Select the package or org scope
   - **Permissions**: Read and Write
   - **Bypass 2FA**: Check this (prevents OTP prompts in CI)

   ```
   mcp__chrome-devtools__fill(uid: "<ref>", value: "<token-name>")
   mcp__chrome-devtools__click(uid: "<ref>")  # Each dropdown/checkbox
   ```

6. Submit and capture the token:
   ```
   mcp__chrome-devtools__click(uid: "<ref>")  # "Generate Token" button
   mcp__chrome-devtools__take_snapshot()       # Token appears on next page
   ```

7. **IMPORTANT:** Do not take screenshots of pages showing tokens.

8. Store the token:
   ```bash
   # Save to ~/.npmrc for local use
   echo "//registry.npmjs.org/:_authToken=<token>" > ~/.npmrc
   npm whoami  # Verify

   # Set as GitHub secret for CI
   gh secret set NPM_TOKEN --repo <owner>/<repo> --body "<token>"
   ```

9. Optionally save to 1Password:
   ```bash
   op item create --category=login --title="NPM_TOKEN" \
     --vault="API Credentials" "credential=<token>"
   ```

## Phase 3: First Publish

The package must exist on npm before OIDC can be configured.

```bash
# Build first
bun run build

# Check package hygiene
bun run hygiene 2>&1 || true

# Dry run to verify contents
npm pack --dry-run

# Publish (scoped packages need --access public)
npm publish --access public --no-provenance
```

**Key gotchas:**
- `--no-provenance` is required for local publishes -- provenance only works in GitHub Actions OIDC
- If `npm publish` asks for an OTP code, the `~/.npmrc` token is bad. Fix the token, don't enter a 2FA code
- Scoped packages (`@org/name`) return E404 until first publish registers them

Verify:
```bash
npm view "$PACKAGE" version  # Should return the version you just published
```

## Phase 4: Configure OIDC Trusted Publishing (Chrome DevTools MCP)

After the package exists on npm, set up OIDC so CI never needs `NPM_TOKEN`.

**Ask the user:** _"Package is published. I'll now configure OIDC trusted publishing via the npm website. Proceed?"_

### Browser Flow

1. Navigate to the package access page:
   ```
   PACKAGE=$(node -p "require('./package.json').name")
   mcp__chrome-devtools__navigate_page(type: "url", url: "https://www.npmjs.com/package/${PACKAGE}/access")
   ```

2. Take a snapshot to check the page state:
   ```
   mcp__chrome-devtools__take_snapshot()
   ```

3. **If login page appears:** Ask the user to log in in Chrome. Then re-snapshot.

4. **If 2FA page appears:** Ask the user to authenticate with their fingerprint. Then re-snapshot.

5. Find and click the **"GitHub Actions"** button under Trusted Publisher:
   ```
   mcp__chrome-devtools__click(uid: "<ref>")  # "Add Trusted Publisher connection for GitHub Actions"
   ```

6. Take a snapshot to get the form field uids:
   ```
   mcp__chrome-devtools__take_snapshot()
   ```

7. Fill the form with **exact values**:
   - **Organization or user**: GitHub username only (e.g., `nathanvale`) -- NOT `nathanvale/repo-name`
   - **Repository**: GitHub repo name only (e.g., `side-quest-runners`) -- NOT the npm package name
   - **Workflow filename**: `publish.yml` -- just the filename, not the full path

   ```
   mcp__chrome-devtools__fill(uid: "<org-field-ref>", value: "nathanvale")
   mcp__chrome-devtools__fill(uid: "<repo-field-ref>", value: "<repo-name>")
   mcp__chrome-devtools__fill(uid: "<workflow-field-ref>", value: "publish.yml")
   ```

8. Click **"Set up new trusted publisher connection"**:
   ```
   mcp__chrome-devtools__click(uid: "<ref>")
   ```

9. **2FA will be required.** Ask the user to authenticate with their fingerprint in Chrome.

10. Take a snapshot to verify success -- look for the success alert:
    ```
    mcp__chrome-devtools__take_snapshot()
    ```
    Expect to see: `"Successfully added new Trusted Publisher connection."`

## Phase 5: Clean Up

After OIDC is configured, `NPM_TOKEN` is no longer needed for CI:

```bash
# Remove the GitHub secret (OIDC handles auth now)
gh secret delete NPM_TOKEN --repo <owner>/<repo>
```

Verify the full pipeline works:
1. Create a changeset: `bun version:gen --bump patch --summary "Test publish pipeline"`
2. Push to main (or merge a PR)
3. Wait for the Version Packages PR
4. Merge it -- publish should succeed via OIDC

## Fallback: Manual Instructions

If Chrome DevTools MCP is unavailable or the user prefers manual steps:

### Create Granular Token (Manual)

1. Go to `https://www.npmjs.com/settings/<username>/tokens/granular-access-tokens/new`
2. Set token name to `<repo-name>-publish`
3. Set expiration to 90 days
4. Scope to the package or org
5. Set permissions to **Read and Write**
6. Check **Bypass 2FA**
7. Click **Generate Token**
8. Copy the token and run:
   ```bash
   echo "//registry.npmjs.org/:_authToken=<token>" > ~/.npmrc
   gh secret set NPM_TOKEN --repo <owner>/<repo> --body "<token>"
   ```

### Configure OIDC (Manual)

1. Go to `https://www.npmjs.com/package/<package-name>/access`
2. Under **Trusted Publisher**, click **GitHub Actions**
3. Fill in:
   - Organization or user: `<github-username>`
   - Repository: `<github-repo-name>`
   - Workflow filename: `publish.yml`
4. Click **Set up connection**

## Done When

- [ ] `npm whoami` succeeds locally
- [ ] Package exists on npm (`npm view` returns version)
- [ ] OIDC trusted publishing configured on npm
- [ ] `NPM_TOKEN` GitHub secret removed (OIDC replaces it)
- [ ] Test publish succeeds via CI/OIDC
