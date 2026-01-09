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
 * 5. Prints next steps
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

const rl = createInterface({
	input: process.stdin,
	output: process.stdout,
})

function question(prompt: string, defaultValue?: string): Promise<string> {
	const displayPrompt = defaultValue ? `${prompt} [${defaultValue}]: ` : `${prompt}: `
	return new Promise((resolve) => {
		rl.question(displayPrompt, (answer) => {
			resolve(answer.trim() || defaultValue || '')
		})
	})
}

function replaceInFile(filePath: string, replacements: Record<string, string>): void {
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

	const description = await question('Project description', 'A TypeScript library')

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
		writeFileSync('package.json', JSON.stringify(pkg, null, '\t') + '\n')
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

	// Print next steps
	console.log('\n✅ Setup complete!\n')
	console.log('📋 Next steps:\n')
	console.log('  1. Push to GitHub:')
	console.log(`     git remote add origin https://github.com/${githubUser}/${repoName}.git`)
	console.log('     git push -u origin main\n')
	console.log('  2. Configure branch protection:')
	console.log(`     https://github.com/${githubUser}/${repoName}/settings/branches\n`)
	console.log('  3. For npm publishing (first time):')
	console.log('     - Add NPM_TOKEN secret to GitHub repo settings')
	console.log('     - After first publish, configure OIDC trusted publishing at:')
	console.log('       https://www.npmjs.com/package/' + packageName + '/access\n')
	console.log('  4. Start coding:')
	console.log('     bun dev          # Watch mode')
	console.log('     bun test         # Run tests')
	console.log('     bun run build    # Build for production\n')

	rl.close()
}

run().catch((error) => {
	console.error('Setup failed:', error)
	rl.close()
	process.exit(1)
})
