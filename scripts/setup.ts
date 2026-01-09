#!/usr/bin/env bun
/**
 * Interactive setup script for bun-typescript-starter template.
 *
 * Run after cloning/creating from template:
 *   bun run setup
 *
 * This script:
 * 1. Prompts for project details
 * 2. Replaces placeholders in config files
 * 3. Installs dependencies
 * 4. Creates initial commit
 * 5. Optionally creates GitHub repo with branch protection
 * 6. Prints next steps
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

/** Check if GitHub CLI is installed and authenticated */
function hasGitHubCLI(): boolean {
	const result = Bun.spawnSync(['gh', 'auth', 'status'], {
		stdout: 'pipe',
		stderr: 'pipe',
	})
	return result.exitCode === 0
}

/** Run a gh CLI command and return success status */
function runGh(args: string[], silent = false): boolean {
	const result = Bun.spawnSync(['gh', ...args], {
		stdout: silent ? 'pipe' : 'inherit',
		stderr: silent ? 'pipe' : 'inherit',
	})
	return result.exitCode === 0
}

/** Set a GitHub repository secret */
function setRepoSecret(repo: string, name: string, value: string): boolean {
	const result = Bun.spawnSync(['gh', 'secret', 'set', name, '--repo', repo], {
		stdin: new TextEncoder().encode(value),
		stdout: 'pipe',
		stderr: 'pipe',
	})
	return result.exitCode === 0
}

/** Configure GitHub repository settings to match Chatline standards */
async function configureGitHub(
	githubUser: string,
	repoName: string,
): Promise<{ success: boolean; npmTokenConfigured: boolean } | false> {
	const repo = `${githubUser}/${repoName}`
	console.log('\n🔧 Configuring GitHub repository...\n')

	// 1. Configure repo settings (squash merge only, delete branch on merge, auto-merge)
	console.log('  Setting merge options (squash only, auto-delete branches)...')
	const repoSettings = runGh([
		'api',
		`repos/${repo}`,
		'--method',
		'PATCH',
		'-f',
		'allow_squash_merge=true',
		'-f',
		'allow_merge_commit=false',
		'-f',
		'allow_rebase_merge=false',
		'-f',
		'delete_branch_on_merge=true',
		'-f',
		'allow_auto_merge=true',
	])
	if (!repoSettings) {
		console.log('  ⚠️  Could not configure repo settings')
	}

	// 2. Configure branch protection for main
	console.log('  Setting branch protection rules...')

	// The protection rules need to be sent as JSON input
	const protectionPayload = JSON.stringify({
		required_status_checks: {
			strict: true,
			contexts: ['All checks passed'],
		},
		enforce_admins: true,
		required_pull_request_reviews: {
			dismiss_stale_reviews: true,
			require_code_owner_reviews: false,
			required_approving_review_count: 0,
		},
		restrictions: null,
		required_linear_history: true,
		allow_force_pushes: false,
		allow_deletions: false,
	})

	// Run with stdin input for JSON payload
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
		const stderr = new TextDecoder().decode(protectionResult.stderr)
		if (stderr.includes('Not Found')) {
			console.log(
				'  ⚠️  Branch protection requires pushing code first (main branch must exist)',
			)
			return false
		}
		console.log('  ⚠️  Could not configure branch protection')
		console.log(`     ${stderr}`)
		return false
	}

	// 3. Set NPM_TOKEN secret if available in environment
	let npmTokenConfigured = false
	const npmToken = process.env.NPM_TOKEN
	if (npmToken) {
		console.log('  Setting NPM_TOKEN secret (found in environment)...')
		if (setRepoSecret(repo, 'NPM_TOKEN', npmToken)) {
			console.log('  ✅ NPM_TOKEN secret configured!')
			npmTokenConfigured = true
		} else {
			console.log('  ⚠️  Could not set NPM_TOKEN secret')
		}
	} else {
		console.log('  ℹ️  NPM_TOKEN not found in environment - skipping')
		console.log('     Add it manually for npm publishing:')
		console.log(`     gh secret set NPM_TOKEN --repo ${repo}`)
	}

	console.log('  ✅ GitHub repository configured!')
	return { success: true, npmTokenConfigured }
}

const rl = createInterface({
	input: process.stdin,
	output: process.stdout,
})

function question(prompt: string, defaultValue?: string): Promise<string> {
	const displayPrompt = defaultValue
		? `${prompt} [${defaultValue}]: `
		: `${prompt}: `
	return new Promise((resolve) => {
		rl.question(displayPrompt, (answer) => {
			resolve(answer.trim() || defaultValue || '')
		})
	})
}

function replaceInFile(
	filePath: string,
	replacements: Record<string, string>,
): void {
	if (!existsSync(filePath)) {
		console.log(`  Skipping ${filePath} (not found)`)
		return
	}

	let content = readFileSync(filePath, 'utf-8')
	for (const [placeholder, value] of Object.entries(replacements)) {
		content = content.replaceAll(placeholder, value)
	}
	writeFileSync(filePath, content)
	console.log(`  Updated ${filePath}`)
}

async function run() {
	console.log('\n🚀 bun-typescript-starter Setup\n')
	console.log('This script will configure your project.\n')

	// Check if already configured
	const packageJson = JSON.parse(readFileSync('package.json', 'utf-8'))
	if (!packageJson.name.includes('{{')) {
		console.log('⚠️  Project appears to already be configured.')
		const proceed = await question('Continue anyway? (y/N)', 'n')
		if (proceed.toLowerCase() !== 'y') {
			console.log('Setup cancelled.')
			rl.close()
			process.exit(0)
		}
	}

	// Gather information
	console.log('📝 Project Details\n')

	const packageName = await question(
		'Package name (e.g., @yourscope/my-lib or my-lib)',
		'my-lib',
	)

	// Extract repo name from package name
	const defaultRepoName = packageName.startsWith('@')
		? packageName.split('/')[1] || 'my-lib'
		: packageName
	const repoName = await question('Repository name', defaultRepoName)

	// Try to detect GitHub user from git config
	let defaultGithubUser = ''
	try {
		const result = Bun.spawnSync(['git', 'config', 'user.name'])
		defaultGithubUser = new TextDecoder().decode(result.stdout).trim()
	} catch {
		// Ignore
	}
	const githubUser = await question('GitHub username/org', defaultGithubUser)

	const description = await question(
		'Project description',
		'A TypeScript library',
	)

	const author = await question('Author name', defaultGithubUser)

	console.log('\n📋 Configuration Summary:\n')
	console.log(`  Package name: ${packageName}`)
	console.log(`  Repository:   ${githubUser}/${repoName}`)
	console.log(`  Description:  ${description}`)
	console.log(`  Author:       ${author}`)

	const confirm = await question('\nProceed with setup? (Y/n)', 'y')
	if (confirm.toLowerCase() === 'n') {
		console.log('Setup cancelled.')
		rl.close()
		process.exit(0)
	}

	// Replace placeholders
	console.log('\n🔧 Configuring files...\n')

	const replacements: Record<string, string> = {
		'{{PACKAGE_NAME}}': packageName,
		'{{REPO_NAME}}': repoName,
		'{{GITHUB_USER}}': githubUser,
		'{{DESCRIPTION}}': description,
		'{{AUTHOR}}': author,
	}

	replaceInFile('package.json', replacements)
	replaceInFile(join('.changeset', 'config.json'), replacements)

	// Install dependencies
	console.log('\n📦 Installing dependencies...\n')
	const installResult = Bun.spawnSync(['bun', 'install'], {
		stdout: 'inherit',
		stderr: 'inherit',
	})

	if (installResult.exitCode !== 0) {
		console.error('❌ Failed to install dependencies')
		rl.close()
		process.exit(1)
	}

	// Initialize git if needed
	console.log('\n🔧 Setting up git...\n')
	if (!existsSync('.git')) {
		Bun.spawnSync(['git', 'init'], { stdout: 'inherit' })
	}

	// Remove this setup script (one-time use)
	console.log('  Removing setup script (one-time use)...')
	try {
		unlinkSync('scripts/setup.ts')
		// Update package.json to remove setup script
		const pkg = JSON.parse(readFileSync('package.json', 'utf-8'))
		delete pkg.scripts.setup
		writeFileSync('package.json', `${JSON.stringify(pkg, null, '\t')}\n`)
	} catch {
		// Ignore if can't delete
	}

	// Create initial commit
	const createCommit = await question('\nCreate initial commit? (Y/n)', 'y')
	if (createCommit.toLowerCase() !== 'n') {
		Bun.spawnSync(['git', 'add', '.'], { stdout: 'inherit' })
		Bun.spawnSync(['git', 'commit', '-m', 'chore: initial project setup'], {
			stdout: 'inherit',
		})
		console.log('  Created initial commit')
	}

	// GitHub setup (optional - requires gh CLI)
	let githubConfigured = false
	let npmTokenConfigured = false
	if (hasGitHubCLI()) {
		const setupGitHub = await question(
			'\nCreate GitHub repo and configure settings? (Y/n)',
			'y',
		)
		if (setupGitHub.toLowerCase() !== 'n') {
			console.log('\n🌐 Setting up GitHub repository...\n')

			// Check if repo already exists
			const repoExists = Bun.spawnSync(
				['gh', 'repo', 'view', `${githubUser}/${repoName}`],
				{ stdout: 'pipe', stderr: 'pipe' },
			)

			if (repoExists.exitCode !== 0) {
				// Create the repo
				console.log(`  Creating repository ${githubUser}/${repoName}...`)
				const createResult = Bun.spawnSync(
					[
						'gh',
						'repo',
						'create',
						`${githubUser}/${repoName}`,
						'--public',
						'--source=.',
						'--push',
						'--description',
						description,
					],
					{ stdout: 'inherit', stderr: 'inherit' },
				)

				if (createResult.exitCode !== 0) {
					console.log('  ⚠️  Could not create GitHub repository')
					console.log('     You can create it manually and push later.')
				} else {
					console.log('  ✅ Repository created and code pushed!')
					// Now configure the repo settings and branch protection
					const result = await configureGitHub(githubUser, repoName)
					if (result && typeof result === 'object') {
						githubConfigured = result.success
						npmTokenConfigured = result.npmTokenConfigured
					}
				}
			} else {
				// Repo exists, just set remote and push
				console.log('  Repository already exists, pushing code...')

				// Check if origin remote exists
				const remoteResult = Bun.spawnSync(
					['git', 'remote', 'get-url', 'origin'],
					{
						stdout: 'pipe',
						stderr: 'pipe',
					},
				)

				if (remoteResult.exitCode !== 0) {
					Bun.spawnSync([
						'git',
						'remote',
						'add',
						'origin',
						`git@github.com:${githubUser}/${repoName}.git`,
					])
				}

				const pushResult = Bun.spawnSync(
					['git', 'push', '-u', 'origin', 'main'],
					{
						stdout: 'inherit',
						stderr: 'inherit',
					},
				)

				if (pushResult.exitCode === 0) {
					console.log('  ✅ Code pushed!')
					const result = await configureGitHub(githubUser, repoName)
					if (result && typeof result === 'object') {
						githubConfigured = result.success
						npmTokenConfigured = result.npmTokenConfigured
					}
				} else {
					console.log('  ⚠️  Could not push to GitHub')
				}
			}
		}
	} else {
		console.log(
			'\n💡 Tip: Install GitHub CLI (gh) to auto-configure repo settings',
		)
		console.log('   brew install gh && gh auth login')
	}

	// Print next steps
	console.log('\n✅ Setup complete!\n')

	const steps: string[] = []
	let stepNum = 1

	// Only show push instructions if GitHub wasn't configured
	if (!githubConfigured) {
		steps.push(`  ${stepNum}. Push to GitHub:`)
		steps.push(
			`     git remote add origin git@github.com:${githubUser}/${repoName}.git`,
		)
		steps.push('     git push -u origin main\n')
		stepNum++

		steps.push(`  ${stepNum}. Configure branch protection:`)
		steps.push(
			`     https://github.com/${githubUser}/${repoName}/settings/branches`,
		)
		steps.push('     - Enable "Require pull request before merging"')
		steps.push('     - Enable "Require status checks to pass"')
		steps.push('     - Enable "Require linear history"\n')
		stepNum++

		steps.push(`  ${stepNum}. Configure repo settings:`)
		steps.push(`     https://github.com/${githubUser}/${repoName}/settings`)
		steps.push('     - Allow squash merging only')
		steps.push('     - Enable "Automatically delete head branches"')
		steps.push('     - Enable "Allow auto-merge"\n')
		stepNum++
	}

	// Only show NPM_TOKEN instructions if it wasn't auto-configured
	if (!npmTokenConfigured) {
		steps.push(`  ${stepNum}. For npm publishing (first time):`)
		steps.push(`     gh secret set NPM_TOKEN --repo ${githubUser}/${repoName}`)
		steps.push(
			'     - After first publish, configure OIDC trusted publishing at:',
		)
		steps.push(`       https://www.npmjs.com/package/${packageName}/access\n`)
		stepNum++
	} else {
		steps.push(`  ${stepNum}. For npm publishing:`)
		steps.push('     - NPM_TOKEN secret already configured!')
		steps.push(
			'     - After first publish, configure OIDC trusted publishing at:',
		)
		steps.push(`       https://www.npmjs.com/package/${packageName}/access\n`)
		stepNum++
	}

	steps.push(`  ${stepNum}. Start coding:`)
	steps.push('     bun dev          # Watch mode')
	steps.push('     bun test         # Run tests')
	steps.push('     bun run build    # Build for production\n')

	console.log('📋 Next steps:\n')
	console.log(steps.join('\n'))

	rl.close()
}

run().catch((error) => {
	console.error('Setup failed:', error)
	rl.close()
	process.exit(1)
})
