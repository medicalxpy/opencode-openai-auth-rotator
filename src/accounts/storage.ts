import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type {
  CodexAuthStorage,
  CodexAccount,
  CodexAuthSettings,
  RateLimitSnapshot,
} from '../types.js';
import { CODEX_AUTH_CONSTANTS } from '../types.js';

const CURRENT_VERSION = 1;

function getConfigDir(): string {
  const platform = process.platform;
  if (platform === 'win32') {
    return path.join(process.env['APPDATA'] || os.homedir(), 'opencode');
  }
  if (platform === 'darwin') {
    return path.join(os.homedir(), '.config', 'opencode');
  }
  return path.join(process.env['XDG_CONFIG_HOME'] || path.join(os.homedir(), '.config'), 'opencode');
}

function getDataDir(): string {
  const platform = process.platform;
  if (platform === 'win32') {
    return path.join(process.env['LOCALAPPDATA'] || os.homedir(), 'opencode');
  }
  if (platform === 'darwin') {
    return path.join(os.homedir(), '.local', 'share', 'opencode');
  }
  return path.join(process.env['XDG_DATA_HOME'] || path.join(os.homedir(), '.local', 'share'), 'opencode');
}

function getStoragePath(): string {
  return path.join(getConfigDir(), CODEX_AUTH_CONSTANTS.STORAGE_FILENAME);
}

function getOpenCodeAuthPath(): string {
  return path.join(getDataDir(), CODEX_AUTH_CONSTANTS.OPENCODE_AUTH_PATH);
}

function createDefaultStorage(): CodexAuthStorage {
  return {
    version: CURRENT_VERSION,
    currentAccountId: undefined,
    accounts: [],
    settings: {
      rotationThreshold: CODEX_AUTH_CONSTANTS.DEFAULT_ROTATION_THRESHOLD,
      checkQuotaBeforeRequest: true,
      rateLimitRefreshInterval: CODEX_AUTH_CONSTANTS.DEFAULT_REFRESH_INTERVAL_MS,
    },
  };
}

function ensureDirectory(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function loadStorage(): CodexAuthStorage {
  const storagePath = getStoragePath();
  
  if (!fs.existsSync(storagePath)) {
    return createDefaultStorage();
  }
  
  try {
    const content = fs.readFileSync(storagePath, 'utf-8');
    const data = JSON.parse(content) as CodexAuthStorage;
    
    if (!data.version || data.version < CURRENT_VERSION) {
      return migrateStorage(data);
    }
    
    return data;
  } catch {
    return createDefaultStorage();
  }
}

export function saveStorage(storage: CodexAuthStorage): void {
  const storagePath = getStoragePath();
  ensureDirectory(storagePath);
  
  storage.version = CURRENT_VERSION;
  fs.writeFileSync(storagePath, JSON.stringify(storage, null, 2), 'utf-8');
}

interface LegacyAccountData {
  accessToken: string;
  refreshToken?: string;
  expiresAtMs?: number;
  addedAtMs?: number;
  chatgptAccountId?: string;
}

interface LegacyStorage {
  currentAccountId?: string;
  accounts?: Record<string, LegacyAccountData> | CodexAccount[];
  settings?: Partial<CodexAuthSettings>;
  version?: number;
}

function migrateStorage(oldData: LegacyStorage): CodexAuthStorage {
  const defaultStorage = createDefaultStorage();
  
  let accounts: CodexAccount[] = [];
  
  // Handle legacy object-based accounts format
  if (oldData.accounts && !Array.isArray(oldData.accounts)) {
    // Convert object { id: accountData } to array
    accounts = Object.entries(oldData.accounts).map(([id, data]) => ({
      id,
      name: id, // Will be updated if we can extract from token
      tokens: {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresAt: data.expiresAtMs,
        tokenType: 'Bearer',
      },
      accountId: data.chatgptAccountId ?? id,
      createdAt: data.addedAtMs ?? Date.now(),
    }));
    
    // Try to extract email from JWT for display name
    for (const account of accounts) {
      try {
        const payload = JSON.parse(
          Buffer.from(account.tokens.accessToken.split('.')[1], 'base64').toString()
        );
        const email = payload['https://api.openai.com/profile']?.email;
        if (email) {
          account.name = email;
        }
      } catch {
        // Keep default name
      }
    }
  } else if (Array.isArray(oldData.accounts)) {
    accounts = oldData.accounts;
  }
  
  return {
    version: CURRENT_VERSION,
    currentAccountId: oldData.currentAccountId ?? defaultStorage.currentAccountId,
    accounts,
    settings: {
      ...defaultStorage.settings,
      ...oldData.settings,
    },
  };
}

export function getCurrentAccount(storage: CodexAuthStorage): CodexAccount | undefined {
  if (!storage.currentAccountId) {
    return storage.accounts[0];
  }
  return storage.accounts.find(a => a.id === storage.currentAccountId);
}

export function addAccount(storage: CodexAuthStorage, account: CodexAccount): CodexAuthStorage {
  const existingIndex = storage.accounts.findIndex(a => a.id === account.id);
  
  if (existingIndex >= 0) {
    storage.accounts[existingIndex] = account;
  } else {
    storage.accounts.push(account);
  }
  
  if (!storage.currentAccountId) {
    storage.currentAccountId = account.id;
  }
  
  return storage;
}

export function removeAccount(storage: CodexAuthStorage, accountId: string): CodexAuthStorage {
  storage.accounts = storage.accounts.filter(a => a.id !== accountId);
  
  if (storage.currentAccountId === accountId) {
    storage.currentAccountId = storage.accounts[0]?.id;
  }
  
  return storage;
}

export function setCurrentAccount(storage: CodexAuthStorage, accountId: string): CodexAuthStorage {
  const account = storage.accounts.find(a => a.id === accountId);
  if (account) {
    storage.currentAccountId = accountId;
    account.lastUsedAt = Date.now();
  }
  return storage;
}

export function updateAccountRateLimits(
  storage: CodexAuthStorage,
  accountId: string,
  rateLimits: RateLimitSnapshot
): CodexAuthStorage {
  const account = storage.accounts.find(a => a.id === accountId);
  if (account) {
    account.rateLimits = rateLimits;
    account.rateLimitsUpdatedAt = Date.now();
  }
  return storage;
}

export function updateSettings(
  storage: CodexAuthStorage,
  settings: Partial<CodexAuthSettings>
): CodexAuthStorage {
  storage.settings = { ...storage.settings, ...settings };
  return storage;
}

export function syncToOpenCodeAuth(account: CodexAccount): void {
  const authPath = getOpenCodeAuthPath();
  ensureDirectory(authPath);

  let existing: unknown = undefined;
  if (fs.existsSync(authPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(authPath, 'utf-8')) as unknown;
    } catch {
      existing = undefined;
    }
  }

  const base = (existing && typeof existing === 'object') ? (existing as Record<string, unknown>) : {};

  const openai = {
    type: 'oauth',
    access: account.tokens.accessToken,
    refresh: account.tokens.refreshToken,
    expires: account.tokens.expiresAt,
    accountId: account.accountId,
  };

  const authData = {
    ...base,
    openai,
  };

  fs.writeFileSync(authPath, JSON.stringify(authData, null, 2), 'utf-8');
}

export function generateAccountId(): string {
  return `codex_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

interface OpenCodeAuthJson {
  openai?: {
    type: string;
    access: string;
    refresh: string;
    expires: number;
    accountId?: string;
  };
}

export function extractEmailFromJwt(accessToken: string): string | null {
  try {
    const parts = accessToken.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    return payload['https://api.openai.com/profile']?.email || null;
  } catch {
    return null;
  }
}

export function extractAccountIdFromJwt(accessToken: string): string | null {
  try {
    const parts = accessToken.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    return payload['https://api.openai.com/auth']?.chatgpt_account_id || null;
  } catch {
    return null;
  }
}

export function importFromOpenCodeAuth(): CodexAccount | null {
  const authPath = getOpenCodeAuthPath();
  
  if (!fs.existsSync(authPath)) {
    return null;
  }
  
  try {
    const content = fs.readFileSync(authPath, 'utf-8');
    const data = JSON.parse(content) as OpenCodeAuthJson;
    
    if (!data.openai?.access || !data.openai?.refresh) {
      return null;
    }
    
    const accessToken = data.openai.access;
    const refreshToken = data.openai.refresh;
    const expiresAt = data.openai.expires;
    const accountIdFromAuth = data.openai.accountId;
    
    const email = extractEmailFromJwt(accessToken);
    const accountIdFromJwt = extractAccountIdFromJwt(accessToken);
    const accountId = accountIdFromAuth || accountIdFromJwt || generateAccountId();
    
    const account: CodexAccount = {
      id: accountId,
      name: email || `account-${accountId.slice(0, 8)}`,
      tokens: {
        accessToken,
        refreshToken,
        expiresAt,
        tokenType: 'Bearer',
      },
      accountId,
      createdAt: Date.now(),
    };
    
    return account;
  } catch {
    return null;
  }
}

export function createAccountFromRefreshToken(refreshToken: string, name?: string): CodexAccount {
  const accountId = generateAccountId();
  
  return {
    id: accountId,
    name: name || `account-${accountId.slice(0, 8)}`,
    tokens: {
      accessToken: '', // Will be refreshed on first use
      refreshToken,
      expiresAt: 0,
      tokenType: 'Bearer',
    },
    accountId,
    createdAt: Date.now(),
  };
}

export { getConfigDir, getDataDir, getStoragePath, getOpenCodeAuthPath };
