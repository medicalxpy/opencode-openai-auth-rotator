# OpenCode OpenAI Auth Rotator

OpenCode plugin + CLI to manage multiple OpenAI (Codex/ChatGPT) accounts and rotate the active auth when you are near rate limits.

This project maintains a multi-account store, and syncs the *currently selected* account into OpenCode's native `auth.json` so OpenCode uses that account automatically.

---

## Features

- Multi-account storage (unlimited accounts)
- Quota / rate limit tracking (5-hour + weekly windows)
- **Automatic rotation**: plugin checks quota every 60 seconds and auto-rotates when threshold exceeded
- Manual rotate and quota-based rotation via CLI
- Toast notification in OpenCode (periodic quota display + rotation alerts)
- Import from OpenCode native login (recommended; avoids private OAuth client IDs)

---

## Requirements

- Node.js >= 18
- OpenCode installed

---

## Install (from source)

```bash
npm install
npm run build
```

### Enable plugin in OpenCode

Add the built plugin entry to your OpenCode config.

Example (edit your OpenCode config file):

```json
{
  "plugins": [
    "/absolute/path/to/opencode-openai-auth-rotator/dist/index.mjs"
  ]
}
```

---

## Usage: CLI

The CLI is installed as `codex-auth` (from `bin`).

### Import account from OpenCode native auth (recommended)

This reads OpenCode's `~/.local/share/opencode/auth.json` and imports the current OpenAI account into the multi-account store.

```bash
codex-auth import
```

To add multiple accounts: login with a different account in OpenCode (native login) and run `codex-auth import` again.

### Add account with refresh token (manual)

```bash
codex-auth add-token
```

Note: a refresh-token-only account may need a refresh step before it can be used for API calls.

### List accounts

```bash
codex-auth list
```

### Manual rotate

```bash
codex-auth rotate
```

### Auto rotate by threshold

Rotate when *usedPercent >= threshold* in either window.

```bash
codex-auth check --threshold 90
```

### Show current quota

```bash
codex-auth quota
```

---

## Usage: OpenCode plugin tools

The plugin registers these tools:

- `codex_list`: list stored accounts
- `codex_quota`: fetch quota usage for current account
- `codex_rotate`: manual rotate
- `codex_check`: refresh + rotate when near limit
- `codex_login`: OAuth PKCE login (may fail; OpenAI uses private client IDs)

The plugin also shows a periodic quota toast (default: every 60 seconds) and **automatically rotates** to the next available account when the current account exceeds the threshold (default: 90%).

---

## Auto-Rotation Behavior

When enabled as a plugin, the rotator runs automatically:

1. Every 60 seconds, refreshes quota for all accounts
2. Checks if current account usage exceeds threshold (default 90%)
3. If exceeded, switches to the first available account below threshold
4. Shows a Toast notification on rotation

To adjust the threshold:

```bash
codex-auth check --threshold 80
```

Or call `codex_check` tool with `thresholdPercent` parameter.

---

## Storage & file formats

### Multi-account store

- Path: `~/.config/opencode/codex_auth.json`
- Contains: `accounts[]`, `currentAccountId`, cached quota snapshots, settings.

### OpenCode native auth sync target

- Path: `~/.local/share/opencode/auth.json`

OpenCode expects (simplified):

```json
{
  "openai": {
    "type": "oauth",
    "access": "...",
    "refresh": "...",
    "expires": 0,
    "accountId": "..."
  }
}
```

On rotation we update only the `openai` section and preserve other providers (e.g. `google`).

---

## Rotation logic

- **Automatic (plugin)**: Every 60 seconds, refreshes all quotas. If current account exceeds threshold, rotates to first available account below threshold. Shows Toast on rotation.
- **Manual rotate**: Moves to the next account in `accounts[]` order (round-robin), no quota checks.
- **CLI auto rotate** (`codex-auth check`): Refreshes quota for the current account; if current is above threshold, picks the first other account below threshold.

---

## Troubleshooting

### `TypeError: undefined is not an object (evaluating 'currentAuth.type')`

Cause: OpenCode expects `auth.json` to contain `openai.type`. This repo now writes OpenCode-compatible auth (`openai: { type, access, refresh, expires }`) and merges with existing providers.

If you still see it, inspect `~/.local/share/opencode/auth.json` and ensure it has `openai.type`.

---

## Development

```bash
npm run dev        # tsup --watch
npm run typecheck
npm run build
```

---

## Security notes

- Tokens are stored locally in plain JSON. Treat `~/.config/opencode/codex_auth.json` and `~/.local/share/opencode/auth.json` as secrets.
- Do not commit tokens to Git.

---

## License

MIT
