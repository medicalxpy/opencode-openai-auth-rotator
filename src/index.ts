import type { PluginInput } from '@opencode-ai/plugin';
import { tool } from '@opencode-ai/plugin/tool';
import { getAccountManager } from './accounts/manager.js';
import { createQuotaDisplayInfo } from './quota/tracker.js';
import { renderProgressBar } from './utils/format.js';

const TOAST_INTERVAL_MS = 60 * 1000;

function formatQuotaToast(manager: ReturnType<typeof getAccountManager>): string | null {
  const current = manager.getCurrentAccount();
  if (!current) return null;

  const info = createQuotaDisplayInfo(current);
  const parts: string[] = [];

  if (info.primary) {
    parts.push(`5h: ${info.primary.remainingPercent.toFixed(0)}%`);
  }
  if (info.secondary) {
    parts.push(`week: ${info.secondary.remainingPercent.toFixed(0)}%`);
  }

  if (parts.length === 0) return null;
  return `${current.name} | ${parts.join(' | ')}`;
}

const plugin = async (input: PluginInput) => {
  const { client } = input;
  
  let manager: ReturnType<typeof getAccountManager>;
  try {
    manager = getAccountManager();
    manager.startAutoRefresh();
  } catch {
    return { tool: {} };
  }

  const showQuotaToast = async () => {
    try {
      await manager.refreshAllQuotas();
      manager.reload();

      const rotateResult = await manager.checkAndRotate();
      manager.reload();
      
      if (rotateResult.rotated) {
        await client.tui.showToast({
          body: {
            title: 'Codex Auto-Rotate',
            message: rotateResult.reason ?? 'Switched to next account',
            variant: 'warning',
            duration: 8000,
          },
        });
      }

      const message = formatQuotaToast(manager);
      if (!message) return;

      const current = manager.getCurrentAccount();
      const info = current ? createQuotaDisplayInfo(current) : null;
      const primaryRemaining = info?.primary?.remainingPercent ?? 100;
      const secondaryRemaining = info?.secondary?.remainingPercent ?? 100;

      let variant: 'info' | 'warning' | 'error' = 'info';
      if (primaryRemaining < 20 || secondaryRemaining < 20) {
        variant = 'error';
      } else if (primaryRemaining < 50 || secondaryRemaining < 50) {
        variant = 'warning';
      }

      await client.tui.showToast({
        body: {
          title: 'Codex Quota',
          message,
          variant,
          duration: 5000,
        },
      });
    } catch {
    }
  };

  showQuotaToast();
  setInterval(showQuotaToast, TOAST_INTERVAL_MS);

  return {
    tool: {
      codex_login: tool({
        description: 'Login via OpenAI OAuth and store tokens in ~/.config/opencode/codex_auth.json; sync current account to ~/.local/share/opencode/auth.json (openai)',
        args: {},
        async execute() {
          try {
            const account = await manager.login();
            const info = createQuotaDisplayInfo(account);
            return JSON.stringify({
              success: true,
              message: `Successfully logged in as ${account.name}`,
              account: {
                id: account.id,
                name: account.name,
                planType: info.planType,
              },
            });
          } catch (error) {
            return JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : 'Login failed',
            });
          }
        },
      }),

      codex_list: tool({
        description: 'List stored accounts in ~/.config/opencode/codex_auth.json',
        args: {},
        async execute() {
          const accounts = manager.getAccounts();
          const current = manager.getCurrentAccount();

          if (accounts.length === 0) {
            return JSON.stringify({
              accounts: [],
              message: 'No accounts configured. Use codex_login to add an account.',
            });
          }

          return JSON.stringify({
            currentAccountId: current?.id,
            accounts: accounts.map(a => {
              const info = createQuotaDisplayInfo(a);
              return {
                id: a.id,
                name: a.name,
                isCurrent: a.id === current?.id,
                planType: info.planType,
                primaryUsed: info.primary?.usedPercent,
                secondaryUsed: info.secondary?.usedPercent,
                lastUsed: a.lastUsedAt ? new Date(a.lastUsedAt).toISOString() : undefined,
              };
            }),
          });
        },
      }),

      codex_rotate: tool({
        description: 'Rotate current account in ~/.config/opencode/codex_auth.json and sync to ~/.local/share/opencode/auth.json (openai)',
        args: {},
        async execute() {
          const result = manager.rotate();
          return JSON.stringify({
            ...result,
            currentAccount: manager.getCurrentAccount()?.name,
          });
        },
      }),

      codex_quota: tool({
        description: 'Fetch quota usage for the current account',
        args: {},
        async execute() {
          const current = manager.getCurrentAccount();
          if (!current) {
            return JSON.stringify({
              success: false,
              error: 'No account configured. Use codex_login first.',
            });
          }

          try {
            await manager.refreshAccountQuota(current.id);
            manager.reload();
            const updated = manager.getCurrentAccount();
            if (!updated) {
              return JSON.stringify({ success: false, error: 'Account not found after refresh' });
            }

            const info = createQuotaDisplayInfo(updated);
            return JSON.stringify({
              success: true,
              account: updated.name,
              planType: info.planType,
              primary: info.primary ? {
                label: info.primary.label,
                usedPercent: info.primary.usedPercent,
                remainingPercent: info.primary.remainingPercent,
                progressBar: renderProgressBar(info.primary.remainingPercent),
                resetsAt: info.primary.resetsAt?.toISOString(),
              } : undefined,
              secondary: info.secondary ? {
                label: info.secondary.label,
                usedPercent: info.secondary.usedPercent,
                remainingPercent: info.secondary.remainingPercent,
                progressBar: renderProgressBar(info.secondary.remainingPercent),
                resetsAt: info.secondary.resetsAt?.toISOString(),
              } : undefined,
              credits: info.credits,
              lastUpdated: info.lastUpdated?.toISOString(),
            });
          } catch (error) {
            return JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : 'Failed to fetch quota',
            });
          }
        },
      }),

      codex_check: tool({
        description: 'Fetch quota usage for current account and rotate to next account when near rate limit',
        args: {
          thresholdPercent: tool.schema.number().optional().describe('Usage threshold percentage to trigger rotation (default: 90)'),
        },
        async execute(args) {
          const thresholdPercent = args.thresholdPercent ?? manager.getSettings().rotationThreshold;
          const threshold = thresholdPercent;

          if (args.thresholdPercent !== undefined) {
            manager.updateSettings({ rotationThreshold: args.thresholdPercent });
          }

          try {
            const result = await manager.checkAndRotate();
            const current = manager.getCurrentAccount();

            return JSON.stringify({
              ...result,
              threshold,
              currentAccount: current?.name,
              currentAccountQuota: current ? createQuotaDisplayInfo(current) : undefined,
            });
          } catch (error) {
            return JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : 'Check failed',
            });
          }
        },
      }),
    },
  };
};

export default plugin;
