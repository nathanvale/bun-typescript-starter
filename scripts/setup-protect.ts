#!/usr/bin/env bun
/**
 * Enable branch protection on the main branch.
 *
 * Run this after you've finished your initial setup commits and pushes.
 * Separated from the main setup script so that branch protection doesn't
 * block subsequent pushes during initial project configuration.
 *
 * Usage:
 *   bun run setup:protect
 */

import { readFileSync } from 'node:fs'

type BranchResponse = {
	commit?: {
		sha?: string
	}
}

type CheckRunsResponse = {
	check_runs?: Array<{
		name?: string
		app?: {
			id?: number
		}
	}>
}

type RulesetSummary = {
	id?: number
	name?: string
}

const textDecoder = new TextDecoder()

/** Check if GitHub CLI is installed and authenticated */
function hasGitHubCLI(): boolean {
	const result = Bun.spawnSync(['gh', 'auth', 'status'], {
		stdout: 'pipe',
		stderr: 'pipe',
	})
	return result.exitCode === 0
}

function decodeOutput(output: Uint8Array): string {
	return textDecoder.decode(output).trim()
}

function runGitHubJson<T>(args: string[]): T | null {
	const result = Bun.spawnSync(['gh', ...args], {
		stdout: 'pipe',
		stderr: 'pipe',
	})
	if (result.exitCode !== 0) {
		return null
	}

	try {
		return JSON.parse(decodeOutput(result.stdout)) as T
	} catch {
		return null
	}
}

function runGitHubWithJsonInput(
	args: string[],
	payload: unknown,
): { ok: boolean; stderr: string } {
	const result = Bun.spawnSync(['gh', ...args, '--input', '-'], {
		stdin: new TextEncoder().encode(JSON.stringify(payload)),
		stdout: 'pipe',
		stderr: 'pipe',
	})
	return {
		ok: result.exitCode === 0,
		stderr: decodeOutput(result.stderr),
	}
}

function deleteRuleset(
	repo: string,
	id: number,
): { ok: boolean; stderr: string } {
	const result = Bun.spawnSync(
		[
			'gh',
			'api',
			`repos/${repo}/rulesets/${id}`,
			'--method',
			'DELETE',
			'-H',
			'Accept: application/vnd.github+json',
		],
		{
			stdout: 'pipe',
			stderr: 'pipe',
		},
	)
	return {
		ok: result.exitCode === 0,
		stderr: decodeOutput(result.stderr),
	}
}

/** Detect repo owner/name from git remote or package.json */
function detectRepo(): string | null {
	// Try git remote first
	const result = Bun.spawnSync(
		['gh', 'repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'],
		{ stdout: 'pipe', stderr: 'pipe' },
	)
	if (result.exitCode === 0) {
		return decodeOutput(result.stdout)
	}

	// Fallback: parse from package.json repository URL
	try {
		const pkg = JSON.parse(readFileSync('package.json', 'utf-8'))
		const url: string = pkg.repository?.url ?? ''
		const match = url.match(/github\.com[/:]([^/]+\/[^/.]+)/)
		if (match?.[1]) return match[1]
	} catch {
		// Ignore
	}

	return null
}

/**
 * Pin the required check to the GitHub App that currently emits the gate.
 *
 * This avoids the legacy `contexts`-only configuration that can leave PRs
 * stuck in a blocked state even when all modern check runs have passed.
 */
function detectGateCheckAppId(repo: string): number | null {
	const branch = runGitHubJson<BranchResponse>([
		'api',
		`repos/${repo}/branches/main`,
	])
	const sha = branch?.commit?.sha
	if (!sha) {
		return null
	}

	const checks = runGitHubJson<CheckRunsResponse>([
		'api',
		`repos/${repo}/commits/${sha}/check-runs`,
	])
	const gateCheck = checks?.check_runs?.find(
		(check) => check.name === 'All checks passed',
	)
	return gateCheck?.app?.id ?? null
}

function upsertRuleset(repo: string, name: string, payload: unknown): void {
	const existingRulesets =
		runGitHubJson<RulesetSummary[]>(['api', `repos/${repo}/rulesets`]) ?? []
	const existing = existingRulesets.find((ruleset) => ruleset.name === name)

	if (existing?.id) {
		const deletion = deleteRuleset(repo, existing.id)
		if (!deletion.ok) {
			console.error(`❌ Could not replace ruleset "${name}".`)
			console.error(`   ${deletion.stderr}`)
			process.exit(1)
		}
	}

	const creation = runGitHubWithJsonInput(
		[
			'api',
			`repos/${repo}/rulesets`,
			'--method',
			'POST',
			'-H',
			'Accept: application/vnd.github+json',
		],
		payload,
	)

	if (!creation.ok) {
		console.error(`❌ Could not configure ruleset "${name}".`)
		console.error(`   ${creation.stderr}`)
		process.exit(1)
	}
}

function run() {
	console.log('\n🔒 Branch Protection Setup\n')

	if (!hasGitHubCLI()) {
		console.error(
			'❌ GitHub CLI (gh) is required. Install it with: brew install gh',
		)
		process.exit(1)
	}

	const repo = detectRepo()
	if (!repo) {
		console.error('❌ Could not detect GitHub repository.')
		console.error('   Make sure you have a git remote pointing to GitHub.')
		process.exit(1)
	}

	console.log(`  Repository: ${repo}`)
	console.log('  Setting branch protection and rulesets on main...\n')

	const requiredCheckContexts = ['All checks passed', 'Sensitive path review']

	const gateCheckAppId = detectGateCheckAppId(repo)
	if (gateCheckAppId !== null) {
		console.log(
			`  Found "All checks passed" check provider (GitHub App ID ${gateCheckAppId}).`,
		)
	} else {
		console.log(
			'  No existing gate check found on main yet; allowing any app for the first bootstrap.',
		)
	}

	const protectionPayload = JSON.stringify({
		required_status_checks: {
			// Requiring branches to be up to date creates constant Dependabot
			// churn in template-derived repos. We still require the gate checks,
			// but let GitHub evaluate them on the PR head SHA instead.
			strict: false,
			// The full branch-protection endpoint still requires `contexts`.
			// We apply fine-grained `checks` via the dedicated status-check endpoint below.
			contexts: requiredCheckContexts,
		},
		enforce_admins: true,
		required_pull_request_reviews: {
			dismiss_stale_reviews: true,
			require_code_owner_reviews: false,
			required_approving_review_count: 0,
		},
		restrictions: null,
		required_linear_history: true,
		// Keep bot-authored release PRs mergeable even if advisory review tools
		// leave unresolved comments that humans have already triaged as noise.
		required_conversation_resolution: false,
		allow_force_pushes: false,
		allow_deletions: false,
	})

	const protectionResult = Bun.spawnSync(
		[
			'gh',
			'api',
			`repos/${repo}/branches/main/protection`,
			'--method',
			'PUT',
			'-H',
			'Accept: application/vnd.github+json',
			'--input',
			'-',
		],
		{
			stdin: new TextEncoder().encode(protectionPayload),
			stdout: 'pipe',
			stderr: 'pipe',
		},
	)

	if (protectionResult.exitCode !== 0) {
		const stderr = decodeOutput(protectionResult.stderr)
		if (stderr.includes('Not Found')) {
			console.error(
				'❌ Main branch not found. Push at least one commit before enabling protection.',
			)
		} else {
			console.error('❌ Could not configure branch protection.')
			console.error(`   ${stderr}`)
		}
		process.exit(1)
	}

	const statusChecksPayload = JSON.stringify({
		strict: true,
		checks: requiredCheckContexts.map((context) =>
			gateCheckAppId !== null
				? { context, app_id: gateCheckAppId }
				: { context, app_id: -1 },
		),
	})

	const statusChecksResult = Bun.spawnSync(
		[
			'gh',
			'api',
			`repos/${repo}/branches/main/protection/required_status_checks`,
			'--method',
			'PATCH',
			'-H',
			'Accept: application/vnd.github+json',
			'--input',
			'-',
		],
		{
			stdin: new TextEncoder().encode(statusChecksPayload),
			stdout: 'pipe',
			stderr: 'pipe',
		},
	)

	if (statusChecksResult.exitCode !== 0) {
		const stderr = decodeOutput(statusChecksResult.stderr)
		console.error('❌ Could not configure status check protection.')
		console.error(`   ${stderr}`)
		process.exit(1)
	}

	const branchRulesetPayload = {
		name: 'Main branch governance',
		target: 'branch',
		enforcement: 'active',
		conditions: {
			ref_name: {
				include: ['refs/heads/main'],
				exclude: [],
			},
		},
		rules: [
			{
				type: 'required_status_checks',
				parameters: {
					strict_required_status_checks_policy: true,
					required_status_checks: requiredCheckContexts.map((context) =>
						gateCheckAppId !== null
							? { context, integration_id: gateCheckAppId }
							: { context },
					),
				},
			},
			{ type: 'required_linear_history' },
			{ type: 'deletion' },
			{ type: 'non_fast_forward' },
		],
	}

	const tagRulesetPayload = {
		name: 'Release tag protection',
		target: 'tag',
		enforcement: 'active',
		conditions: {
			ref_name: {
				include: ['refs/tags/v*'],
				exclude: [],
			},
		},
		rules: [{ type: 'update' }, { type: 'deletion' }],
	}

	upsertRuleset(repo, 'Main branch governance', branchRulesetPayload)
	upsertRuleset(repo, 'Release tag protection', tagRulesetPayload)

	console.log('  ✅ Branch protection enabled on main!')
	console.log('     - Requires PR for all changes')
	console.log(
		'     - Requires status checks: "All checks passed" + "Sensitive path review"',
	)
	console.log(
		'     - Pins the gate to the current GitHub Actions check app when detected',
	)
	console.log('     - Requires linear history')
	console.log('     - Blocks force pushes and branch deletion')
	console.log('     - Adds repository rulesets for main and release tags')
}

run()
