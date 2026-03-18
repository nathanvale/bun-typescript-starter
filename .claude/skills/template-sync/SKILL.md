---
name: template-sync
description: Sync governed hardening changes from a template repo into downstream repositories. Use when uplifting repos after starter-template changes, propagating workflow/release hardening, or preparing a sync PR from a known template commit range.
argument-hint: [target-repo-or-path]
disable-model-invocation: true
allowed-tools: Read, Bash(git *), Bash(gh *)
---

# Template Sync

## Quick Start

Use this skill when a downstream repo needs to absorb hardening changes from the template.

Expected inputs:
- Target repo path or `owner/name`
- Source template repo path
- Commit range to sync, for example `82c663b..HEAD`

Default assumption:
- This is a governed sync, not a freeform refactor.
- Prefer deterministic file and settings updates.
- Use the model only for conflict resolution and repo-specific adaptation.

For the governed file matrix and rollout checklist, see [reference.md](reference.md).

Helper command:

```bash
bun .claude/skills/template-sync/scripts/analyze-sync.ts \
  --source /path/to/template \
  --target /path/to/target \
  --range 82c663b..HEAD
```

Protection helper:

```bash
bun .claude/skills/template-sync/scripts/apply-protection.ts \
  --target /path/to/target
```

## Workflow

### Step 0: Find Target Repos

If no target repo is specified, discover downstream repos inline:

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

**Step 2: Filter to locally cloned repos:**
```bash
for name in <repo-names-from-step-1>; do
  [ -d "$HOME/code/$name" ] && echo "$name" || true
done
```

**Step 3:** Present as a numbered list and let the user pick which one(s) to sync.

### Step 1: Gather Context

Read the template diff for the requested commit range.

If available, start with the helper script to generate a first-pass inventory:
- `bun .claude/skills/template-sync/scripts/analyze-sync.ts --source ... --target ... --range ...`

Capture:
- Changed files
- Commit titles and intent
- Whether each change is a file sync, a GitHub setting sync, or a manual/adaptive change

Read the target repo's current state before proposing edits.

### Step 2: Classify Changes

Sort template changes into three buckets:

1. Safe to sync directly
2. Safe to sync with repo-specific placeholders or substitutions
3. Requires human review or LLM-assisted adaptation

Never treat all changed files as equally safe.

### Step 3: Plan Before Editing

Produce a short sync plan that includes:
- Files to copy or patch
- GitHub settings to apply with `gh api`
- Risks and assumptions
- Validation steps

Pause for confirmation before making repo changes.

### Step 4: Apply Incrementally

When approved:
- Update governed files in small chunks
- Keep changes scoped to the requested hardening uplift
- Preserve target-repo customizations unless the template change intentionally replaces them

For GitHub settings, prefer explicit `gh api` calls over vague manual guidance.

### Step 5: Verify

Run the target repo's relevant checks after each meaningful chunk:
- Formatting
- Lint
- Typecheck
- Tests
- Workflow validation if available

If a repo cannot support a template change cleanly, stop and report the mismatch instead of forcing the sync.

If the target repo includes `scripts/setup-protect.ts`, use the protection helper in `plan` mode before mutating GitHub-side controls:
- `bun .claude/skills/template-sync/scripts/apply-protection.ts --target ...`

Only use `--mode apply` after the user confirms.

### Step 6: Prepare the PR

Summarize:
- What was synced directly
- What was adapted
- What still needs manual follow-up
- Any secrets, variables, or environment setup required

## Safety Rules

- Never do a blind file overwrite without reading the target file first.
- Never remove target-specific behavior unless the user explicitly approves it.
- Never use the model as the source of truth when the template diff is available.
- Never mutate GitHub settings without listing them first.
- Never run protection apply in `apply` mode without explicit confirmation.
- Prefer one sync PR per repo.

## Success Criteria

- The target repo reflects the intended template hardening changes.
- The diff is explainable file by file.
- Validation passes or failures are documented precisely.
- The PR includes clear follow-up for secrets, app credentials, labels, or rulesets.

## Example Invocation

`/template-sync ../side-quest-marketplace`

Then supply:
- template repo path
- target repo path
- commit range
- any target-specific constraints
