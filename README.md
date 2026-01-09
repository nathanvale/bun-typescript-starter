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

### Option A: Use this template (Recommended)

1. Click **"Use this template"** → **"Create a new repository"**
2. Clone your new repo
3. Run setup:

```bash
bun run setup
```

The setup script will:
- Prompt for project details (name, description, author)
- Configure package.json and changeset config
- Install dependencies
- Create initial commit

### Option B: degit

```bash
npx degit nathanvale/bun-typescript-starter my-project
cd my-project
bun run setup
```

## What's Included

### CI/CD Workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `pr-quality.yml` | PR | Lint → Typecheck → Test with coverage |
| `publish.yml` | Push to main | Auto-publish via Changesets |
| `commitlint.yml` | PR | Enforce conventional commits |
| `pr-title.yml` | PR | Validate PR title format |
| `security.yml` | Push/Schedule | CodeQL + Trivy scanning |
| `dependency-review.yml` | PR | Supply chain security |
| `dependabot-auto-merge.yml` | Dependabot PR | Auto-merge patch updates |

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
bun run version:gen  # Create changeset
bun run release      # Publish to npm (CI handles this)
```

## NPM Publishing

This template uses **OIDC trusted publishing** for secure, token-free npm releases.

### First Publish (Bootstrap)

1. Add `NPM_TOKEN` secret to your GitHub repository:
   - Go to repo Settings → Secrets → Actions
   - Create `NPM_TOKEN` with your npm access token

2. Create a changeset and push to main:
   ```bash
   bun run version:gen
   git add . && git commit -m "chore: add changeset"
   git push
   ```

3. The publish workflow will use `NPM_TOKEN` for the first publish

### Subsequent Publishes (OIDC)

After the first publish, configure **trusted publishing** for token-free releases:

1. Go to [npmjs.com](https://www.npmjs.com) → Your Package → Settings
2. Under "Trusted Publisher", configure:
   - **Owner:** Your GitHub username/org
   - **Repository:** Your repo name
   - **Environment:** (leave blank)
   - **Workflow:** `publish.yml`

3. Remove `NPM_TOKEN` secret (optional but recommended)

Now pushes to main will publish automatically via OIDC - no tokens needed!

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

After pushing your repo, configure branch protection:

1. Go to Settings → Branches → Add rule
2. Branch name pattern: `main`
3. Enable:
   - Require a pull request before merging
   - Require status checks to pass
   - Require branches to be up to date

## License

MIT

---

Built with [bun-typescript-starter](https://github.com/nathanvale/bun-typescript-starter)
