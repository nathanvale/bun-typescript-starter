# bun-typescript-starter

Modern TypeScript starter template with enterprise-grade tooling.

## Features

- **Bun** - Fast all-in-one JavaScript runtime and toolkit
- **TypeScript 5.9+** - Strict mode, ESM only
- **Biome** - Lightning-fast linting and formatting (replaces ESLint + Prettier)
- **Vitest** - Fast unit testing with native Bun support
- **Changesets** - Automated versioning and changelog generation
- **GitHub Actions** - Comprehensive CI/CD with OIDC npm publishing
- **Conventional Commits** - Enforced via commitlint + Husky

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) installed (`curl -fsSL https://bun.sh/install | bash`)
- [GitHub CLI](https://cli.github.com) installed and authenticated (`gh auth login`)
- [npm account](https://www.npmjs.com) with package ownership or scope access

### Option A: GitHub CLI (Recommended)

Create a new repo from this template and set it up in one command:

```bash
# Create repo from template
gh repo create myusername/my-lib --template nathanvale/bun-typescript-starter --public --clone

# Run setup (interactive)
cd my-lib
bun run setup
```

### Option B: CLI Mode (Non-Interactive)

For automated/scripted setups, pass all arguments via CLI flags:

```bash
# Create repo from template
gh repo create myusername/my-lib --template nathanvale/bun-typescript-starter --public --clone
cd my-lib

# Run setup with all arguments (no prompts)
bun run setup -- \
  --name "@myusername/my-lib" \
  --description "My awesome library" \
  --author "Your Name" \
  --yes
```

### Option C: degit

```bash
npx degit nathanvale/bun-typescript-starter my-lib
cd my-lib
bun run setup
```

## Setup Script

The setup script configures your project and optionally creates the GitHub repository with all settings pre-configured.

### Interactive Mode

```bash
bun run setup
```

Prompts for:
- Package name (e.g., `@myusername/my-lib` or `my-lib`)
- Repository name
- GitHub username/org
- Project description
- Author name

### CLI Mode

```bash
bun run setup -- [options]
```

| Flag | Short | Description |
|------|-------|-------------|
| `--name` | `-n` | Package name (e.g., `@myusername/my-lib`) |
| `--repo` | `-r` | Repository name (defaults to package name) |
| `--user` | `-u` | GitHub username/org (auto-detected from `gh`) |
| `--description` | `-d` | Project description |
| `--author` | `-a` | Author name |
| `--yes` | `-y` | Skip confirmation prompts (auto-yes) |
| `--no-github` | | Skip GitHub repo creation/configuration |
| `--help` | `-h` | Show help |

### What Setup Does

1. **Configures files** - Replaces placeholders in `package.json` and `.changeset/config.json`
2. **Installs dependencies** - Runs `bun install`
3. **Creates initial commit** - Commits all configured files
4. **Creates GitHub repo** (if it doesn't exist) - Uses `gh repo create`
5. **Configures GitHub settings**:
   - Enables workflow permissions for PR creation
   - Locks GitHub Actions to SHA-pinned workflows plus the template allowlist
   - Sets squash-only merging
   - Enables auto-delete branches
   - Enables auto-merge
   - Seeds the `manual-release` environment
   - Configures branch protection plus repository rulesets for the required gates

## Complete Setup Guide

This guide walks through the full process of creating a new package and publishing it to npm.

### Step 1: Create Repository

```bash
# Create and clone from template
gh repo create myusername/my-lib --template nathanvale/bun-typescript-starter --public --clone
cd my-lib
```

### Step 2: Run Setup

```bash
# Interactive mode
bun run setup

# Or non-interactive mode
bun run setup -- \
  --name "@myusername/my-lib" \
  --description "My awesome library" \
  --author "Your Name" \
  --yes
```

### Step 3: Install Changeset Bot

Install the [Changeset Bot](https://github.com/apps/changeset-bot) GitHub App on your repo. It comments on every PR with changeset status so you know at a glance whether version bumps are queued.

1. Visit https://github.com/apps/changeset-bot
2. Click **Install** and select your repository
3. Grant the requested permissions (pull request read/write, contents read-only)

> The bot works alongside the `autogenerate-changeset.yml` workflow — the bot comments instantly, and the workflow auto-generates a changeset file if one is missing.

### Step 4: Configure GitHub App Credentials

The release and auto-merge workflows use a GitHub App token so bot-authored
PRs can still trigger downstream workflows and enable native auto-merge.

1. Create or reuse a GitHub App and install it on the repository.
2. Grant these repository permissions:
   - **Contents:** Read and write
   - **Pull requests:** Read and write
   - **Actions:** Read and write
   - **Metadata:** Read-only
3. Save the App ID as a repository variable:

```bash
gh variable set APP_ID --body "<app-id>" --repo myusername/my-lib
```

4. Save the private key PEM as a repository secret:

```bash
gh secret set APP_PRIVATE_KEY --repo myusername/my-lib
```

> Without these credentials, `publish.yml` and
> `version-packages-auto-merge.yml` will fail early with a setup error instead
> of silently creating release PRs that never progress.

### Step 5: Configure npm Trusted Publishing

This template is designed for npm trusted publishing via GitHub OIDC.
For an existing npm package, configure that first and skip long-lived tokens.

1. Go to [npmjs.com](https://www.npmjs.com) → Your Package → Settings → Publishing Access
2. Click **Add Trusted Publisher**
3. Configure:
   - **Owner:** Your GitHub username/org
   - **Repository:** Your repo name
   - **Workflow file:** `publish.yml`
4. Save changes

### Step 6: Bootstrap the First Publish (Brand-New Packages Only)

If the package does not exist on npm yet, bootstrap the first publish with a
short-lived granular token, then remove it once trusted publishing is active.

#### Create npm Granular Access Token

1. Go to [npmjs.com](https://www.npmjs.com) → Access Tokens → Generate New Token → **Granular Access Token**

2. Configure the token:
   - **Token name:** `github-actions-publish` (or any name)
   - **Expiration:** 90 days (maximum for granular tokens)
   - **Packages and scopes:** Select "All packages" for new packages, or specific packages for existing ones
   - **Permissions:** Read and write
   - **IMPORTANT:** Check **"Bypass two-factor authentication for automation"**

   > Without "Bypass 2FA", CI/CD publishing will fail with "Access token expired or revoked"

3. Copy the token (starts with `npm_`)

#### Add Token to GitHub Secrets

```bash
# If you have NPM_TOKEN in your environment
echo "$NPM_TOKEN" | gh secret set NPM_TOKEN --repo myusername/my-lib

# Or set it interactively
gh secret set NPM_TOKEN --repo myusername/my-lib
# Paste your token when prompted
```

### Step 7: Create Initial Release

Create a changeset describing your initial release:

```bash
# Create a feature branch
git checkout -b feat/initial-release

# Create changeset file
mkdir -p .changeset
cat > .changeset/initial-release.md << 'EOF'
---
"@myusername/my-lib": minor
---

Initial release
EOF

# Commit and push
git add .changeset/initial-release.md
git commit -m "chore: add changeset for initial release"
git push -u origin feat/initial-release

# Create PR
gh pr create --title "chore: add changeset for initial release" --body "Initial release"
```

### Step 8: Merge and Publish

1. **Wait for CI checks** to pass on your PR
2. **Merge the PR** - This triggers the changesets workflow
3. **A "Version Packages" PR** will be automatically created
4. **The Version PR auto-merges once checks pass** - This triggers the publish workflow
5. **Package is published to npm!**

```bash
# Check your package
npm view @myusername/my-lib
```

### Step 9: Remove the Bootstrap Token

Once trusted publishing is active:

1. Remove the `NPM_TOKEN` secret from GitHub
2. In npm package settings, disallow token-based publishing if your workflow allows it
3. Keep the publish path OIDC-only for ongoing releases

## NPM Token Setup

### Why Granular Tokens?

Classic npm tokens are gone, and npm tightened token defaults again on
September 29, 2025. Use **granular access tokens** only as a bootstrap fallback
for brand-new packages, then move to trusted publishing.

### Token Requirements

| Setting | Value | Why |
|---------|-------|-----|
| Type | Granular Access Token | Classic tokens no longer work |
| Packages | All packages (for new) or specific | Allows publishing |
| Permissions | Read and write | Required to publish |
| **Bypass 2FA** | **Checked** | **Required only for bootstrap token publishing** |

### Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| "Access token expired or revoked" | Token doesn't have "Bypass 2FA" or has expired | Create a new short-lived bootstrap token with 2FA bypass |
| "E404 Not Found" | Token doesn't have publish permissions | Check token has read/write access |
| "E403 Forbidden" | Package scope mismatch | Ensure token covers your package scope |
| OIDC publish denied | Trusted publisher not configured or repo/workflow mismatch | Re-check npm Trusted Publisher owner, repo, and `publish.yml` workflow |

## What's Included

### CI/CD Workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `pr-quality.yml` | PR | Lint, Typecheck, Test with coverage |
| `publish.yml` | Push to main | Auto-publish via Changesets |
| `sensitive-paths-review.yml` | PR + PR review | Requires human approval when automation paths change |
| `autogenerate-changeset.yml` | PR | Auto-generate changeset if missing |
| `commitlint.yml` | PR | Enforce conventional commits |
| `pr-title.yml` | PR | Validate PR title format |
| `security.yml` | Schedule/Manual | OSV vulnerability scanning |
| `dependency-review.yml` | PR | Supply chain security |
| `dependabot-auto-merge.yml` | Dependabot PR | Auto-merge patch updates |

### GitHub Apps

| App | Purpose |
|-----|---------|
| [Changeset Bot](https://github.com/apps/changeset-bot) | PR comments with changeset status |
| Your release automation app | Generates install tokens for `publish.yml` and `version-packages-auto-merge.yml` via `APP_ID` + `APP_PRIVATE_KEY` |

### Scripts

```bash
# Development
bun dev              # Watch mode
bun run build        # Build for production
bun run clean        # Remove dist/

# Quality
bun run check        # Biome lint + format (write)
bun run lint         # Lint only
bun run format       # Format only
bun run typecheck    # TypeScript type check
bun run validate     # Full quality check (lint + types + build + test)

# Testing
bun test             # Run tests
bun test --watch     # Watch mode
bun run coverage     # With coverage report

# Publishing
bun run version:gen  # Create changeset interactively
bun run release      # Publish to npm (CI handles this)
```

## Project Structure

```
├── .github/
│   ├── workflows/        # CI/CD workflows
│   ├── actions/          # Reusable composite actions
│   └── scripts/          # CI helper scripts
├── .husky/               # Git hooks
├── .changeset/           # Changeset config
├── src/
│   └── index.ts          # Main entry point
├── tests/
│   └── index.test.ts     # Example test
├── biome.json            # Biome config
├── tsconfig.json         # TypeScript config
├── bunup.config.ts       # Build config
└── package.json
```

## Configuration

### Biome

Configured in `biome.json`:
- Tab indentation
- 80 character line width
- Single quotes
- Organize imports on save

### TypeScript

- Strict mode enabled
- ESM output
- Source maps and declarations

### Changesets

- GitHub changelog format
- Public npm access
- Provenance enabled

## Branch Protection

The setup script automatically configures protection for `main` and release tags:

- Require pull request before merging
- Require status checks to pass (`All checks passed` and `Sensitive path review`)
- Pin required checks to the active GitHub Actions app when detected
- Require linear history
- No force pushes
- No deletions
- No required conversation resolution on `main` so bot-authored release PRs do not hang on advisory comments
- Add a repository ruleset for `refs/heads/main`
- Add a tag ruleset for immutable `v*` release tags
- Seed a `manual-release` environment for manual prerelease/snapshot workflows
- Lock GitHub Actions to SHA-pinned workflows plus the small allowlist used by this template

If you need to manually configure it:

1. Go to Settings → Branches → Add rule
2. Branch name pattern: `main`
3. Enable the settings above

## Troubleshooting

### Setup script hangs

If running in a non-TTY environment (like some CI systems), use CLI flags:

```bash
bun run setup -- --name "my-lib" --description "desc" --author "name" --yes
```

### CI can't create PRs

The setup script enables this automatically. If you need to do it manually:

```bash
gh api repos/OWNER/REPO/actions/permissions/workflow \
  --method PUT \
  -f default_workflow_permissions=write \
  -F can_approve_pull_request_reviews=true
```

### Version PR checks don't run

The template dispatches `pr-quality.yml` automatically from
`version-packages-auto-merge.yml`, so you should not need to push an empty
commit anymore.

If a release PR still shows all check runs green but GitHub keeps it blocked,
re-apply protection so the required gates are configured via the modern
check-run API and repository rulesets instead of the legacy status-only path:

```bash
bun run setup:protect
```

As a temporary fallback for an already-stuck branch:

```bash
git fetch origin
git checkout changeset-release/main
git commit --allow-empty -m "chore: trigger CI"
git push
```

### npm publish fails with 404

1. If this is a bootstrap publish, ensure your granular token has "Bypass 2FA" checked
2. Ensure the token has "Read and write" permissions
3. Ensure the token covers "All packages" (for new packages)
4. Once the package exists, switch to trusted publishing and remove the token

## License

MIT

---

Built with [bun-typescript-starter](https://github.com/nathanvale/bun-typescript-starter)
