import type { CodexAccount, CodexAuthStorage, RotationResult } from '../types.js';
import {
  loadStorage,
  saveStorage,
  getCurrentAccount,
  addAccount,
  removeAccount,
  setCurrentAccount,
  updateAccountRateLimits,
  syncToOpenCodeAuth,
  generateAccountId,
} from './storage.js';
import { performLogin } from '../auth/oauth.js';
import {
  fetchRateLimitsForAccount,
  shouldRotateAccount,
  createQuotaDisplayInfo,
  formatQuotaStatus,
} from '../quota/tracker.js';

export class CodexAccountManager {
  private storage: CodexAuthStorage;
  private refreshTimer?: ReturnType<typeof setInterval>;

  constructor() {
    this.storage = loadStorage();
  }

  private save(): void {
    saveStorage(this.storage);
  }

  getAccounts(): CodexAccount[] {
    return this.storage.accounts;
  }

  getCurrentAccount(): CodexAccount | undefined {
    return getCurrentAccount(this.storage);
  }

  async login(): Promise<CodexAccount> {
    const { tokens, userInfo } = await performLogin();

    const account: CodexAccount = {
      id: generateAccountId(),
      name: userInfo?.email ?? userInfo?.name ?? 'Codex Account',
      tokens,
      accountId: userInfo?.sub,
      createdAt: Date.now(),
    };

    this.storage = addAccount(this.storage, account);
    this.save();

    syncToOpenCodeAuth(account);

    try {
      await this.refreshAccountQuota(account.id);
    } catch {
      // intentionally empty - quota refresh failure should not block login
    }

    return account;
  }

  removeAccount(accountId: string): void {
    this.storage = removeAccount(this.storage, accountId);
    this.save();

    const current = this.getCurrentAccount();
    if (current) {
      syncToOpenCodeAuth(current);
    }
  }

  switchAccount(accountId: string): CodexAccount | undefined {
    this.storage = setCurrentAccount(this.storage, accountId);
    this.save();

    const account = this.getCurrentAccount();
    if (account) {
      syncToOpenCodeAuth(account);
    }
    return account;
  }

  async refreshAccountQuota(accountId: string): Promise<void> {
    const account = this.storage.accounts.find(a => a.id === accountId);
    if (!account) return;

    const { rateLimits, updatedTokens } = await fetchRateLimitsForAccount(account);

    if (updatedTokens) {
      account.tokens = updatedTokens;
    }

    this.storage = updateAccountRateLimits(this.storage, accountId, rateLimits);
    this.save();
  }

  async refreshAllQuotas(): Promise<void> {
    const refreshPromises = this.storage.accounts.map(async (account) => {
      try {
        await this.refreshAccountQuota(account.id);
      } catch {
        // Continue with other accounts
      }
    });

    await Promise.all(refreshPromises);
  }

  async checkAndRotate(): Promise<RotationResult> {
    const current = this.getCurrentAccount();
    if (!current) {
      return { rotated: false, reason: 'No accounts configured' };
    }

    await this.refreshAccountQuota(current.id);

    const threshold = this.storage.settings.rotationThreshold;
    if (!shouldRotateAccount(current.rateLimits, threshold)) {
      return { rotated: false, reason: 'Current account within quota' };
    }

    const availableAccounts = this.storage.accounts.filter(a => {
      if (a.id === current.id) return false;
      return !shouldRotateAccount(a.rateLimits, threshold);
    });

    if (availableAccounts.length === 0) {
      return {
        rotated: false,
        previousAccountId: current.id,
        reason: 'All accounts at or above threshold',
      };
    }

    const nextAccount = availableAccounts[0];
    this.switchAccount(nextAccount.id);

    return {
      rotated: true,
      previousAccountId: current.id,
      newAccountId: nextAccount.id,
      reason: `Rotated from ${current.name} to ${nextAccount.name}`,
    };
  }

  rotate(): RotationResult {
    const current = this.getCurrentAccount();
    if (!current) {
      return { rotated: false, reason: 'No accounts configured' };
    }

    const currentIndex = this.storage.accounts.findIndex(a => a.id === current.id);
    const nextIndex = (currentIndex + 1) % this.storage.accounts.length;
    const nextAccount = this.storage.accounts[nextIndex];

    if (!nextAccount || nextAccount.id === current.id) {
      return { rotated: false, reason: 'Only one account available' };
    }

    this.switchAccount(nextAccount.id);

    return {
      rotated: true,
      previousAccountId: current.id,
      newAccountId: nextAccount.id,
      reason: `Rotated to ${nextAccount.name}`,
    };
  }

  getQuotaStatus(): string {
    const current = this.getCurrentAccount();
    if (!current) {
      return 'No accounts configured. Use /codex-login to add an account.';
    }

    const info = createQuotaDisplayInfo(current);
    return formatQuotaStatus(info);
  }

  getSettings() {
    return this.storage.settings;
  }

  updateSettings(settings: Partial<CodexAuthStorage['settings']>): void {
    this.storage.settings = { ...this.storage.settings, ...settings };
    this.save();
  }

  startAutoRefresh(): void {
    if (this.refreshTimer) return;

    const interval = this.storage.settings.rateLimitRefreshInterval;
    this.refreshTimer = setInterval(() => {
      this.refreshAllQuotas().catch(() => {});
    }, interval);
  }

  stopAutoRefresh(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  reload(): void {
    this.storage = loadStorage();
  }
}

let managerInstance: CodexAccountManager | undefined;

export function getAccountManager(): CodexAccountManager {
  if (!managerInstance) {
    managerInstance = new CodexAccountManager();
  }
  return managerInstance;
}
