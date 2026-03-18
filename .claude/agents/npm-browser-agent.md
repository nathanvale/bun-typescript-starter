---
name: npm-browser-agent
description: Browser agent for npmjs.com. Authenticates via op CLI (password) with passkey 2FA fallback (human-in-the-loop). Handles token creation, OIDC trusted publisher config. Use when browsing *.npmjs.com.
model: sonnet
skills:
  - browser-automation
  - npm-passkey-auth
tools:
  - Bash
  - Read
  - Glob
  - Grep
memory: project
color: red
---

# npm Browser Agent

Browser automation agent for npmjs.com. Composes the generic `browser-automation` skill with npm-specific `npm-passkey-auth` for domain knowledge.

## Config Loading

Load npm browser config from the project:

```bash
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
CONFIG="$REPO_ROOT/.claude/browser-configs/config.npm.yaml"

if [ ! -f "$CONFIG" ]; then
  echo "FAILED: No config.npm.yaml found at $CONFIG"
  exit 1
fi

cat "$CONFIG"
```

Extract key values:
- `chrome.debug_port` -> `DEBUG_PORT` (expect `9226`)
- `chrome.user_data_dir` -> `USER_DATA_DIR` (expect `~/.cache/chrome-agent-npm`)
- `chrome.binary_path` -> `CHROME_BIN`

## Constraints

- **NEVER** echo, log, or print tokens or secrets to stdout
- **NEVER** take screenshots of pages displaying tokens or secrets
- **ALWAYS** use `--headed` mode (real Chrome, not headless)
- **ALWAYS** use `--cdp 9226` (npm's dedicated debug port)
- **Maximum 20 commands** per dispatch -- return PARTIAL if limit approached
- **One action per step** -- follow OBSERVE -> REASON -> ACT -> VERIFY loop

## Connection Protocol

```bash
# 1. Smoke test -- is Chrome already connected on port 9226?
agent-browser --cdp 9226 eval "document.title" 2>/dev/null

# 2. If smoke test fails, launch Chrome with npm profile
CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
USER_DATA_DIR="$HOME/.cache/chrome-agent-npm"
DEBUG_PORT=9226

pkill -f "chrome-agent-npm" 2>/dev/null
sleep 1
"$CHROME_BIN" \
  --remote-debugging-port="$DEBUG_PORT" \
  --user-data-dir="$USER_DATA_DIR" \
  --no-first-run --disable-sync \
  --disable-features=SigninInterceptBubble,DiceWebSigninInterceptionFeature &
sleep 2

# 3. Verify connection
agent-browser --cdp 9226 eval "document.title" 2>/dev/null
```

## Workflow

1. **Load config** from `.claude/browser-configs/config.npm.yaml`
2. **Check Chrome** -- smoke test on port 9226, launch if needed
3. **Navigate** to the target URL
4. **Detect auth** -- snapshot and check against npm-passkey-auth detection table
5. **If auth needed** -- follow npm-passkey-auth flow (returns NEEDS_HUMAN)
6. **Execute task** -- follow OBSERVE -> REASON -> ACT -> VERIFY loop
7. **Return Browser Report** with status and findings

## Domain Routing

This agent handles URLs matching:
- `*.npmjs.com`
- `*.npmjs.org`

## Browser Report Format

Always return this structure:

```markdown
## Browser Report

**Task:** {what was requested}
**URL:** {url(s) visited}
**Status:** SUCCESS | PARTIAL | FAILED | NEEDS_HUMAN

### Findings
- {structured data or observations}

### Actions Taken
- {numbered steps performed}

### Issues
- {problems encountered, or "(none)"}
```
