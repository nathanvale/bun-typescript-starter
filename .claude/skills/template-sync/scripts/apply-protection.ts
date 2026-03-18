#!/usr/bin/env bun
/**
 * Preflight and optionally apply the target repo's GitHub protection step.
 *
 * This helper is intentionally conservative:
 * - `plan` mode is the default and makes no changes
 * - `apply` mode runs the target repo's `setup:protect` command
 *
 * Usage:
 *   bun .claude/skills/template-sync/scripts/apply-protection.ts \
 *     --target /path/to/repo
 *
 *   bun .claude/skills/template-sync/scripts/apply-protection.ts \
 *     --target /path/to/repo \
 *     --mode apply
 */

import { existsSync, readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'

type Mode = 'plan' | 'apply'
type Format = 'markdown' | 'json'

type PackageJson = {
	scripts?: Record<string, string>
}

type ProtectionPlan = {
	targetRepo: string
	detectedRepo: string | null
	mode: Mode
	command: string[]
	preflight: {
		hasPackageJson: boolean
		hasSetupProtectScript: boolean
		hasGitHubCli: boolean
		hasGitHubAuth: boolean
	}
	willApply: string[]
	risks: string[]
}

const textDecoder = new TextDecoder()

const { values } = parseArgs({
	options: {
		target: { type: 'string' },
		mode: { type: 'string', default: 'plan' },
		format: { type: 'string', default: 'markdown' },
	},
	strict: true,
	allowPositionals: false,
})

function fail(message: string): never {
	console.error(`Error: ${message}`)
	process.exit(1)
}

function decode(output: Uint8Array): string {
	return textDecoder.decode(output).trim()
}

function runCommand(
	cmd: string[],
	cwd?: string,
): { exitCode: number; stdout: string; stderr: string } {
	const result = Bun.spawnSync(cmd, {
		cwd,
		stdout: 'pipe',
		stderr: 'pipe',
	})

	return {
		exitCode: result.exitCode,
		stdout: decode(result.stdout),
		stderr: decode(result.stderr),
	}
}

function hasGitHubCli(): boolean {
	return runCommand(['gh', '--version']).exitCode === 0
}

function hasGitHubAuth(): boolean {
	return runCommand(['gh', 'auth', 'status']).exitCode === 0
}

function detectRepo(targetRepo: string): string | null {
	const result = runCommand(
		['gh', 'repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'],
		targetRepo,
	)

	if (result.exitCode === 0 && result.stdout) {
		return result.stdout
	}

	return null
}

function readPackageJson(targetRepo: string): PackageJson | null {
	const packageJsonPath = resolve(targetRepo, 'package.json')
	if (!existsSync(packageJsonPath)) {
		return null
	}

	try {
		return JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageJson
	} catch {
		return null
	}
}

function detectProtectCommand(targetRepo: string): string[] {
	const packageJson = readPackageJson(targetRepo)
	const configured = packageJson?.scripts?.['setup:protect']
	if (configured) {
		return ['bun', 'run', 'setup:protect']
	}

	const scriptPath = resolve(targetRepo, 'scripts/setup-protect.ts')
	if (existsSync(scriptPath)) {
		return ['bun', 'scripts/setup-protect.ts']
	}

	fail(
		'target repo is missing both `package.json` script `setup:protect` and `scripts/setup-protect.ts`',
	)
}

function buildPlan(targetRepo: string, mode: Mode): ProtectionPlan {
	const detectedRepo = hasGitHubCli() && hasGitHubAuth() ? detectRepo(targetRepo) : null
	const packageJsonPath = resolve(targetRepo, 'package.json')
	const scriptPath = resolve(targetRepo, 'scripts/setup-protect.ts')

	return {
		targetRepo,
		detectedRepo,
		mode,
		command: detectProtectCommand(targetRepo),
		preflight: {
			hasPackageJson: existsSync(packageJsonPath),
			hasSetupProtectScript: existsSync(scriptPath),
			hasGitHubCli: hasGitHubCli(),
			hasGitHubAuth: hasGitHubAuth(),
		},
		willApply: [
			'Branch protection on `main`',
			'Required checks for `All checks passed` and `Sensitive path review`',
			'GitHub App pinning for the gate check when detected',
			'Main branch governance ruleset',
			'Release tag protection ruleset for `v*` tags',
		],
		risks: [
			'The target repo must already have a `main` branch pushed to GitHub.',
			'The target repo should have the gate workflows present before apply mode is used.',
			'Apply mode mutates live GitHub branch protection and rulesets.',
		],
	}
}

function toMarkdown(plan: ProtectionPlan): string {
	const targetLabel = relative(process.cwd(), plan.targetRepo) || '.'
	const lines = [
		'# Protection Apply Plan',
		'',
		`- Target: \`${targetLabel}\``,
		`- Detected repo: \`${plan.detectedRepo ?? 'unavailable'}\``,
		`- Mode: \`${plan.mode}\``,
		`- Command: \`${plan.command.join(' ')}\``,
		'',
		'## Preflight',
		`- package.json present: ${plan.preflight.hasPackageJson ? 'yes' : 'no'}`,
		`- scripts/setup-protect.ts present: ${plan.preflight.hasSetupProtectScript ? 'yes' : 'no'}`,
		`- gh installed: ${plan.preflight.hasGitHubCli ? 'yes' : 'no'}`,
		`- gh authenticated: ${plan.preflight.hasGitHubAuth ? 'yes' : 'no'}`,
		'',
		'## Will Apply',
		...plan.willApply.map((item) => `- ${item}`),
		'',
		'## Risks',
		...plan.risks.map((item) => `- ${item}`),
	]

	return `${lines.join('\n')}\n`
}

function applyPlan(plan: ProtectionPlan): void {
	if (!plan.preflight.hasGitHubCli) {
		fail('GitHub CLI is not installed')
	}

	if (!plan.preflight.hasGitHubAuth) {
		fail('GitHub CLI is not authenticated')
	}

	const result = Bun.spawnSync(plan.command, {
		cwd: plan.targetRepo,
		stdout: 'inherit',
		stderr: 'inherit',
	})

	if (result.exitCode !== 0) {
		process.exit(result.exitCode)
	}
}

function main() {
	const targetRepo = values.target ? resolve(values.target) : ''
	const mode = values.mode ?? 'plan'
	const format = values.format ?? 'markdown'

	if (!targetRepo) fail('missing required --target')
	if (!existsSync(targetRepo)) fail(`target repo does not exist: ${targetRepo}`)
	if (mode !== 'plan' && mode !== 'apply') {
		fail('mode must be "plan" or "apply"')
	}
	if (format !== 'markdown' && format !== 'json') {
		fail('format must be "markdown" or "json"')
	}

	const plan = buildPlan(targetRepo, mode)

	if (format === 'json') {
		console.log(JSON.stringify(plan, null, 2))
	} else {
		console.log(toMarkdown(plan))
	}

	if (mode === 'apply') {
		applyPlan(plan)
	}
}

main()
