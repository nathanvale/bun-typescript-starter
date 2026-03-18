---
name: npm-passkey-auth
description: Authenticate to npmjs.com using credentials from 1Password via op CLI. Automates username/password login, then triggers passkey 2FA via 1Password browser extension (single human click to approve). Handles Cloudflare challenges.
allowed-tools: Bash(agent-browser *), Bash(op *)
---

# npm Auth

Handle authentication for npmjs.com. Two-phase flow:

1. **Automated** -- username + password filled via `op` CLI
2. **Semi-automated** -- 2FA passkey handled by 1Password browser extension; requires one human click on the "Sign in" button in the 1Password popup

Once authenticated, the session cookie persists in `~/.cache/chrome-agent-npm` for ~2 weeks, so the human click is infrequent.

## Detection Table

| Indicator | Meaning |
|-----------|---------|
| URL contains `/login` | Login page -- auth needed |
| Page shows "Sign In" button | Not authenticated |
| Page shows "Sign Up" button alongside "Sign In" | Landing page, not authenticated |
| URL shows `/settings/` with user content | Authenticated |
| Page shows user avatar/profile menu | Authenticated |
| Page shows token form fields | Authenticated |
| "Security key" / "Use security key" | 2FA challenge -- click it, then NEEDS_HUMAN for 1Password popup |
| 1Password "Sign in with a passkey" popup | 1Password is ready -- NEEDS_HUMAN to click "Sign in" |
| Cloudflare "Verify you are human" | Bot challenge -- NEEDS_HUMAN |

## Auth Flow

### Step 1: Detect Auth State

After navigating to any npm URL, take a snapshot and check against the detection table above.

- **If authenticated indicators present** -> proceed with the task
- **If login/unauthenticated indicators present** -> go to Step 2

### Step 2: Automated Login via op CLI

Get credentials from 1Password and fill the login form.

**Note:** `op read` does not support parentheses in item names. Use `op item get --format json` and extract with jq. The `--fields` flag can return incorrect values (e.g. 65 chars instead of 13 for password).

```bash
# Read credentials (NEVER echo these to stdout)
USERNAME=$(op item get "www.npmjs.com (nathanvale)" --vault="API Credentials" --format json | jq -r '.fields[] | select(.purpose == "USERNAME") | .value')
PASSWORD=$(op item get "www.npmjs.com (nathanvale)" --vault="API Credentials" --format json | jq -r '.fields[] | select(.purpose == "PASSWORD") | .value')
```

1. Navigate to `https://www.npmjs.com/login`
2. Snapshot to find username/password fields
3. Fill username field with `$USERNAME`
4. Fill password field with `$PASSWORD`
5. Click the login/submit button (if 1Password extension overlay blocks the click, submit via JS: `agent-browser --cdp 9226 eval "document.querySelector('form').submit()"`)
6. Snapshot to check result

**NEVER** log, echo, or screenshot credentials.

### Step 3: Handle 2FA -- Passkey via 1Password Extension

After password login, npm redirects to the 2FA security key page. The passkey is stored in 1Password, and the 1Password browser extension handles it.

1. Click **"Use security key"** button on the npm page
2. This triggers the WebAuthn challenge
3. The 1Password browser extension intercepts it and shows a **"Sign in with a passkey"** popup
4. Return `NEEDS_HUMAN` -- the human needs to click **"Sign in"** in the 1Password popup

```bash
agent-browser --cdp 9226 screenshot /tmp/npm-needs-2fa.png
```

Return a Browser Report with:
- **Status:** `NEEDS_HUMAN`
- **What the human needs to do:** "1Password is showing a 'Sign in with a passkey' popup in the Chrome window (port 9226). Click the 'Sign in' button to complete 2FA. Let me know when done."
- **Screenshot path:** `/tmp/npm-needs-2fa.png`

**Why not fully automated?** 1Password requires explicit human approval before releasing passkey credentials. This is a security design decision by 1Password, not an npm limitation. The `op` CLI cannot trigger passkey signing -- only the browser extension can, and it requires a click.

### Step 4: Verify Auth (on re-dispatch after NEEDS_HUMAN)

When re-dispatched after human intervention:

1. Snapshot the page to check current state
2. If still on login/2FA page -> return `NEEDS_HUMAN` again with updated screenshot
3. If authenticated content visible -> return `SUCCESS` and continue with original task

### Session Persistence

After successful auth, the session cookie persists in `~/.cache/chrome-agent-npm` for ~2 weeks. Subsequent agent dispatches will skip auth entirely (Step 1 detects authenticated state).

## Credential Summary

| What | Where |
|------|-------|
| npm username | `op item get "www.npmjs.com (nathanvale)" --vault="API Credentials" --format json \| jq -r '.fields[] \| select(.purpose == "USERNAME") \| .value'` |
| npm password | `op item get "www.npmjs.com (nathanvale)" --vault="API Credentials" --format json \| jq -r '.fields[] \| select(.purpose == "PASSWORD") \| .value'` |
| npm passkey | Stored in 1Password vault, used via browser extension (not op CLI) |
| npm token (CLI/CI) | `op://API Credentials/NPM_TOKEN/credential` |
| Recovery codes | `op item get "NPM Recovery Codes" --vault="API Credentials" --fields notesPlain` (single-use, 5 available -- do NOT use for routine auth) |
| GitHub secret | `gh secret set NPM_TOKEN --body "<token>"` |

## Cloudflare Challenge Handling

npm uses Cloudflare bot protection. If a Cloudflare challenge appears:

1. Take a screenshot:
   ```bash
   agent-browser --cdp 9226 screenshot /tmp/npm-cloudflare-challenge.png
   ```
2. Return `NEEDS_HUMAN` with: "Cloudflare verification required. Please click 'Verify you are human' in the Chrome window."
3. On re-dispatch, snapshot to verify the challenge is resolved, then continue.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Login page keeps appearing after auth | Session cookie not persisting | Check `user_data_dir` is `~/.cache/chrome-agent-npm` (not shared with other agents) |
| "Session expired" after navigating | npm session timeout (default ~2 weeks) | Re-authenticate (automated via op CLI + 1Password passkey click) |
| 1Password popup doesn't appear after "Use security key" | Extension not installed or passkey not in vault | Check Chrome extensions in the agent profile |
| 1Password overlay blocks form buttons | Extension autofill UI covers npm buttons | Submit form via JS: `agent-browser --cdp 9226 eval "document.querySelector('form').submit()"` |
| `op item get` fails | 1Password locked or item not found | Ensure `op` CLI is authenticated: `op whoami` |
| `op item get --fields password` returns wrong value | `--fields` flag unreliable with special chars | Use `--format json` + jq instead (see Step 2) |
| Email OTP page after login (no 2FA) | npm sends email OTP when 2FA is disabled | NEVER disable 2FA -- keep security key enabled. Email OTP requires Gmail access which is harder to automate |

## Important: Do NOT Disable 2FA

npm requires email OTP verification on every login when 2FA is off. This is **harder** to automate than the security key flow (requires Gmail MCP access to `hi@nathanvale.com`). Always keep 2FA enabled with the security key -- the 1Password passkey popup is one click every ~2 weeks.
