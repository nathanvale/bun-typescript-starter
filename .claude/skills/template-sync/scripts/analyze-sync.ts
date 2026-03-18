#!/usr/bin/env bun
/**
 * Analyze a template commit range and classify which changes are safe to sync
 * directly into a downstream repo versus which need adaptation or review.
 *
 * Usage:
 *   bun .claude/skills/template-sync/scripts/analyze-sync.ts \
 *     --source /path/to/template \
 *     --target /path/to/target \
 *     --range 82c663b..HEAD \
 *     --format json
 */

import { existsSync, readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'

type SyncBucket = 'direct' | 'substitute' | 'manual'
type FileState =
	| 'missing-in-target'
	| 'matches-template-head'
	| 'differs-from-template-head'
	| 'deleted-in-template-range'
	| 'not-a-regular-file'

type ChangedFile = {
	path: string
	changeType: string
	bucket: SyncBucket
	state: FileState
	reason: string
}

type GitHubSetting =
	| 'workflow-permissions'
	| 'actions-policy'
	| 'merge-settings'
	| 'manual-release-environment'
	| 'automation-labels'
	| 'branch-protection'
	| 'rulesets'

type AnalysisResult = {
	sourceRepo: string
	targetRepo: string
	commitRange: string
	commits: string[]
	files: ChangedFile[]
	settings: GitHubSetting[]
	summary: {
		direct: number
		substitute: number
		manual: number
	}
}

const DIRECT_PREFIXES = [
	'.github/workflows/',
	'.github/actions/',
	'.github/scripts/',
]

const DIRECT_FILES = new Set([
	'.github/dependabot.yml',
	'scripts/setup.ts',
	'scripts/setup-protect.ts',
])

const SUBSTITUTE_FILES = new Set([
	'.github/CODEOWNERS',
	'.changeset/config.json',
	'package.json',
	'README.md',
])

const textDecoder = new TextDecoder()

const { values } = parseArgs({
	options: {
		source: { type: 'string' },
		target: { type: 'string' },
		range: { type: 'string' },
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

function runGit(repoPath: string, args: string[]): string {
	const result = Bun.spawnSync(['git', '-C', repoPath, ...args], {
		stdout: 'pipe',
		stderr: 'pipe',
	})

	if (result.exitCode !== 0) {
		fail(
			`git ${args.join(' ')} failed for ${repoPath}: ${decode(result.stderr)}`,
		)
	}

	return decode(result.stdout)
}

function readTextIfFile(path: string): string | null {
	if (!existsSync(path)) {
		return null
	}

	try {
		return readFileSync(path, 'utf8')
	} catch {
		return null
	}
}

function classifyPath(path: string): { bucket: SyncBucket; reason: string } {
	if (DIRECT_FILES.has(path)) {
		return {
			bucket: 'direct',
			reason: 'governed infrastructure file kept aligned with the template',
		}
	}

	if (DIRECT_PREFIXES.some((prefix) => path.startsWith(prefix))) {
		return {
			bucket: 'direct',
			reason: 'operational automation path that is usually safe to sync',
		}
	}

	if (SUBSTITUTE_FILES.has(path)) {
		return {
			bucket: 'substitute',
			reason:
				'template structure is useful, but target-specific placeholders or ownership may differ',
		}
	}

	return {
		bucket: 'manual',
		reason: 'path is likely repo-specific or needs human review',
	}
}

function parseChangedFiles(repoPath: string, commitRange: string): ChangedFile[] {
	const output = runGit(repoPath, ['diff', '--name-status', commitRange])
	if (!output) {
		return []
	}

	return output.split('\n').map((line) => {
		const [changeType = '', ...rest] = line.split('\t')
		const path = rest.at(-1) ?? ''
		const { bucket, reason } = classifyPath(path)
		return {
			path,
			changeType,
			bucket,
			state: 'not-a-regular-file',
			reason,
		}
	})
}

function resolveFileState(
	sourceRepo: string,
	targetRepo: string,
	file: ChangedFile,
): FileState {
	if (file.changeType.startsWith('D')) {
		return 'deleted-in-template-range'
	}

	const sourcePath = resolve(sourceRepo, file.path)
	const targetPath = resolve(targetRepo, file.path)
	const sourceContent = readTextIfFile(sourcePath)
	const targetContent = readTextIfFile(targetPath)

	if (sourceContent === null) {
		return 'not-a-regular-file'
	}

	if (targetContent === null) {
		return 'missing-in-target'
	}

	return sourceContent === targetContent
		? 'matches-template-head'
		: 'differs-from-template-head'
}

function detectSettings(files: ChangedFile[]): GitHubSetting[] {
	const settings = new Set<GitHubSetting>()

	for (const file of files) {
		if (file.path === 'scripts/setup.ts') {
			settings.add('workflow-permissions')
			settings.add('actions-policy')
			settings.add('merge-settings')
			settings.add('manual-release-environment')
			settings.add('automation-labels')
		}

		if (file.path === 'scripts/setup-protect.ts') {
			settings.add('branch-protection')
			settings.add('rulesets')
		}
	}

	return [...settings]
}

function summarize(files: ChangedFile[]): AnalysisResult['summary'] {
	return files.reduce(
		(acc, file) => {
			acc[file.bucket] += 1
			return acc
		},
		{ direct: 0, substitute: 0, manual: 0 },
	)
}

function toMarkdown(result: AnalysisResult): string {
	const lines = [
		'# Template Sync Analysis',
		'',
		`- Source: \`${relative(process.cwd(), result.sourceRepo) || '.'}\``,
		`- Target: \`${relative(process.cwd(), result.targetRepo) || '.'}\``,
		`- Commit range: \`${result.commitRange}\``,
		'',
		'## Commits',
		...result.commits.map((commit) => `- ${commit}`),
		'',
		'## Summary',
		`- Direct sync: ${result.summary.direct}`,
		`- Needs substitution: ${result.summary.substitute}`,
		`- Manual review: ${result.summary.manual}`,
		'',
		'## Files',
	]

	for (const bucket of ['direct', 'substitute', 'manual'] as const) {
		const files = result.files.filter((file) => file.bucket === bucket)
		if (files.length === 0) {
			continue
		}

		lines.push('', `### ${bucket}`)
		for (const file of files) {
			lines.push(
				`- \`${file.path}\` [${file.changeType}] -> ${file.state}. ${file.reason}`,
			)
		}
	}

	if (result.settings.length > 0) {
		lines.push('', '## GitHub Settings To Review')
		for (const setting of result.settings) {
			lines.push(`- ${setting}`)
		}
	}

	return `${lines.join('\n')}\n`
}

function main() {
	const sourceRepo = values.source ? resolve(values.source) : ''
	const targetRepo = values.target ? resolve(values.target) : ''
	const commitRange = values.range ?? ''
	const format = values.format ?? 'markdown'

	if (!sourceRepo) fail('missing required --source')
	if (!targetRepo) fail('missing required --target')
	if (!commitRange) fail('missing required --range')
	if (!existsSync(sourceRepo)) fail(`source repo does not exist: ${sourceRepo}`)
	if (!existsSync(targetRepo)) fail(`target repo does not exist: ${targetRepo}`)
	if (format !== 'markdown' && format !== 'json') {
		fail('format must be "markdown" or "json"')
	}

	const commitsOutput = runGit(sourceRepo, [
		'log',
		'--oneline',
		'--reverse',
		commitRange,
	])
	const files = parseChangedFiles(sourceRepo, commitRange).map((file) => ({
		...file,
		state: resolveFileState(sourceRepo, targetRepo, file),
	}))

	const result: AnalysisResult = {
		sourceRepo,
		targetRepo,
		commitRange,
		commits: commitsOutput ? commitsOutput.split('\n') : [],
		files,
		settings: detectSettings(files),
		summary: summarize(files),
	}

	if (format === 'json') {
		console.log(JSON.stringify(result, null, 2))
		return
	}

	console.log(toMarkdown(result))
}

main()
