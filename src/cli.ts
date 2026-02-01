#!/usr/bin/env node

import { getAccountManager } from './accounts/manager.js';
import { createQuotaDisplayInfo, formatQuotaStatus } from './quota/tracker.js';
import { renderProgressBar } from './utils/format.js';
import { importFromOpenCodeAuth, createAccountFromRefreshToken, loadStorage, addAccount, saveStorage } from './accounts/storage.js';

const HELP = `
codex-auth - Manage multiple OpenAI accounts for OpenCode

Usage:
  codex-auth <command>

Commands:
  import      Import account from OpenCode's native auth
  add-token   Add account using refresh token (paste from browser)
  login       Login via OpenAI OAuth (may not work)
  list        List all stored accounts
  rotate      Rotate to the next account
  quota       Show quota for current account
  check       Check quota and auto-rotate if near limit
  help        Show this help message

Options:
  --threshold <n>   Set rotation threshold percentage (for check command)

Examples:
  codex-auth import              # Import from ~/.local/share/opencode/auth.json
  codex-auth add-token           # Paste refresh token interactively
  codex-auth list
  codex-auth quota
  codex-auth check --threshold 80
`;

function log(msg: string) {
  console.log(msg);
}

function error(msg: string) {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

function cmdImport() {
  const account = importFromOpenCodeAuth();
  
  if (!account) {
    error('No OpenCode auth found at ~/.local/share/opencode/auth.json\nUse `codex-auth add-token` to add an account manually.');
    return;
  }
  
  const storage = loadStorage();
  const existing = storage.accounts.find(a => a.id === account.id);
  
  if (existing) {
    log(`Account ${account.name} already exists. Updating tokens...`);
    existing.tokens = account.tokens;
    saveStorage(storage);
    log(`✓ Updated account: ${account.name}`);
  } else {
    addAccount(storage, account);
    saveStorage(storage);
    log(`✓ Imported account: ${account.name}`);
  }
  
  const manager = getAccountManager();
  manager.reload();
  const info = createQuotaDisplayInfo(account);
  if (info.planType) {
    log(`  Plan: ${info.planType}`);
  }
}

async function cmdAddToken() {
  const readline = await import('node:readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  
  const question = (prompt: string): Promise<string> => 
    new Promise(resolve => rl.question(prompt, resolve));
  
  log('Add account using refresh token');
  log('');
  log('To get your refresh token:');
  log('1. Go to chat.openai.com and log in');
  log('2. Open DevTools (F12) → Application → Cookies');
  log('3. Find cookie starting with "rt_" (refresh token)');
  log('');
  
  const token = await question('Paste refresh token (rt_...): ');
  rl.close();
  
  if (!token.trim()) {
    error('No token provided');
    return;
  }
  
  if (!token.startsWith('rt_')) {
    log('Warning: Token does not start with "rt_". Proceeding anyway...');
  }
  
  const account = createAccountFromRefreshToken(token.trim());
  const storage = loadStorage();
  addAccount(storage, account);
  saveStorage(storage);
  
  log(`\n✓ Added account: ${account.name}`);
  log('  Run `codex-auth quota` to verify and fetch quota info.');
}

async function cmdLogin() {
  const manager = getAccountManager();
  log('Opening browser for OpenAI login...');
  
  try {
    const account = await manager.login();
    const info = createQuotaDisplayInfo(account);
    log(`\n✓ Successfully logged in as ${account.name}`);
    if (info.planType) {
      log(`  Plan: ${info.planType}`);
    }
  } catch (err) {
    error(err instanceof Error ? err.message : 'Login failed');
  }
}

function cmdList() {
  const manager = getAccountManager();
  const accounts = manager.getAccounts();
  const current = manager.getCurrentAccount();

  if (accounts.length === 0) {
    log('No accounts configured. Use `codex-auth login` to add an account.');
    return;
  }

  log(`Accounts (${accounts.length}):\n`);

  for (const account of accounts) {
    const isCurrent = account.id === current?.id;
    const marker = isCurrent ? '→ ' : '  ';
    const info = createQuotaDisplayInfo(account);

    let line = `${marker}${account.name}`;
    if (info.planType) {
      line += ` (${info.planType})`;
    }

    if (info.primary) {
      line += ` 5h:${info.primary.remainingPercent.toFixed(0)}%`;
    }

    if (info.secondary) {
      line += ` week:${info.secondary.remainingPercent.toFixed(0)}%`;
    }

    log(line);
  }
}

function cmdRotate() {
  const manager = getAccountManager();
  const result = manager.rotate();

  if (result.rotated) {
    const newAccount = manager.getCurrentAccount();
    log(`✓ ${result.reason}`);
    if (newAccount) {
      const info = createQuotaDisplayInfo(newAccount);
      if (info.primary) {
        log(`  Quota remaining: ${info.primary.remainingPercent.toFixed(0)}%`);
      }
    }
  } else {
    log(`✗ ${result.reason}`);
  }
}

async function cmdQuota() {
  const manager = getAccountManager();
  const current = manager.getCurrentAccount();

  if (!current) {
    log('No account configured. Use `codex-auth login` first.');
    return;
  }

  log('Fetching quota...\n');

  try {
    await manager.refreshAccountQuota(current.id);
    manager.reload();
    const updated = manager.getCurrentAccount();

    if (!updated) {
      error('Account not found after refresh');
      return;
    }

    const info = createQuotaDisplayInfo(updated);
    log(formatQuotaStatus(info));

    if (info.primary) {
      log(`\n${info.primary.label}:`);
      log(`  ${renderProgressBar(info.primary.remainingPercent)} ${info.primary.remainingPercent.toFixed(1)}% remaining`);
    }

    if (info.secondary) {
      log(`\n${info.secondary.label}:`);
      log(`  ${renderProgressBar(info.secondary.remainingPercent)} ${info.secondary.remainingPercent.toFixed(1)}% remaining`);
    }
  } catch (err) {
    error(err instanceof Error ? err.message : 'Failed to fetch quota');
  }
}

async function cmdCheck(threshold?: number) {
  const manager = getAccountManager();

  if (threshold !== undefined) {
    manager.updateSettings({ rotationThreshold: threshold });
  }

  const settings = manager.getSettings();
  log(`Checking quota (threshold: ${settings.rotationThreshold}%)...\n`);

  try {
    const result = await manager.checkAndRotate();
    const current = manager.getCurrentAccount();

    if (result.rotated) {
      log(`✓ ${result.reason}`);
    } else {
      log(`✓ ${result.reason}`);
    }

    if (current) {
      const info = createQuotaDisplayInfo(current);
      log(`\nCurrent: ${current.name}`);
      if (info.primary) {
        log(`  ${renderProgressBar(info.primary.remainingPercent, 10)} ${info.primary.remainingPercent.toFixed(0)}% remaining`);
      }
    }
  } catch (err) {
    error(err instanceof Error ? err.message : 'Check failed');
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    log(HELP);
    return;
  }

  switch (command) {
    case 'import':
      cmdImport();
      break;

    case 'add-token':
    case 'add':
      await cmdAddToken();
      break;

    case 'login':
      await cmdLogin();
      break;

    case 'list':
    case 'ls':
      cmdList();
      break;

    case 'rotate':
      cmdRotate();
      break;

    case 'quota':
      await cmdQuota();
      break;

    case 'check': {
      const thresholdIdx = args.indexOf('--threshold');
      let threshold: number | undefined;
      if (thresholdIdx !== -1 && args[thresholdIdx + 1]) {
        threshold = parseInt(args[thresholdIdx + 1], 10);
        if (isNaN(threshold) || threshold < 0 || threshold > 100) {
          error('Threshold must be a number between 0 and 100');
        }
      }
      await cmdCheck(threshold);
      break;
    }

    default:
      log(`Unknown command: ${command}\n`);
      log(HELP);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
