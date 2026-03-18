# Template Sync Reference

## Governed File Matrix

These paths are usually good candidates for deterministic sync when the template repo is the source of truth:

- `.github/workflows/`
- `.github/actions/`
- `.github/scripts/`
- `.github/CODEOWNERS`
- `.github/dependabot.yml`
- `scripts/setup.ts`
- `scripts/setup-protect.ts`

These paths usually need repo-aware adaptation:

- `README.md`
- `package.json`
- `.changeset/config.json`
- any workflow file that references package names, release channels, org teams, or repo-specific secrets

## GitHub Settings Matrix

Sync these through `gh api`, not file edits:

- Actions workflow permissions
- Actions policy and selected-actions allowlist
- Merge settings
- Auto-merge enablement
- `manual-release` environment
- Branch protection
- Rulesets
- Labels used by automation

## Classification Heuristics

### Safe Direct Sync

Use when:
- The file is operational infrastructure
- The target repo should stay aligned with the template
- The diff does not contain repo-identity data

Examples:
- harden-runner SHA bumps
- reusable workflow fixes
- sensitive-path review logic
- composite action improvements

### Safe With Substitution

Use when:
- The template change is structurally correct
- The target repo has different owner, package name, or release metadata

Examples:
- `CODEOWNERS`
- environment reviewers
- labels or descriptions that mention the repo owner

### Manual Or LLM-Assisted

Use when:
- The target repo has drifted
- The file contains business logic or product-specific release behavior
- The correct change depends on target-repo context

Examples:
- custom publish steps
- divergent release workflows
- repo-specific docs

## Sync Output Template

Each sync should produce:

1. Scope
   - Template repo
   - Target repo
   - Commit range

2. Planned changes
   - Files to sync directly
   - Files to adapt
   - Settings to apply

3. Risks
   - Potential regressions
   - Missing secrets or variables
   - Workflow assumptions

4. Validation
   - Commands to run
   - Expected signals

5. PR summary
   - Synced
   - Adapted
   - Follow-up required

## Suggested First Version

For the first implementation, keep the workflow simple:

1. Read template diff
2. Read target files
3. Produce sync plan
4. Wait for approval
5. Apply file edits
6. Run checks
7. Report remaining manual GitHub settings

Only automate `gh api` settings changes after the file-sync path is working reliably.

## Protection Helper

The skill now includes a dedicated helper for the GitHub-side protection step:

```bash
bun .claude/skills/template-sync/scripts/apply-protection.ts \
  --target /path/to/repo
```

Use `plan` mode first:
- confirms the target repo has `setup:protect`
- confirms `gh` is installed and authenticated
- lists the protections that will be applied

Use `apply` mode only after confirmation:

```bash
bun .claude/skills/template-sync/scripts/apply-protection.ts \
  --target /path/to/repo \
  --mode apply
```
