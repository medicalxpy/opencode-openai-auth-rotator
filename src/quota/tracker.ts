import type {
  RateLimitSnapshot,
  RateLimitStatusResponse,
  PlanType,
  CodexAccount,
  QuotaDisplayInfo,
} from '../types.js';
import { CODEX_AUTH_CONSTANTS } from '../types.js';
import { formatDuration, formatResetTime } from '../utils/format.js';
import { refreshTokens, isTokenExpired } from '../auth/oauth.js';

const API = CODEX_AUTH_CONSTANTS.API;

function mapPlanType(planType: string): PlanType {
  const mapping: Record<string, PlanType> = {
    free: 'Free',
    go: 'Go',
    plus: 'Plus',
    pro: 'Pro',
    team: 'Team',
    business: 'Business',
    enterprise: 'Enterprise',
    edu: 'Edu',
    education: 'Edu',
  };
  return mapping[planType.toLowerCase()] ?? 'Unknown';
}

function parseRateLimitResponse(response: RateLimitStatusResponse): RateLimitSnapshot {
  const snapshot: RateLimitSnapshot = {
    planType: mapPlanType(response.plan_type),
  };

  if (response.rate_limit?.primary_window) {
    const pw = response.rate_limit.primary_window;
    snapshot.primary = {
      usedPercent: pw.used_percent,
      windowMinutes: Math.ceil(pw.limit_window_seconds / 60),
      resetsAt: pw.reset_at,
    };
  }

  if (response.rate_limit?.secondary_window) {
    const sw = response.rate_limit.secondary_window;
    snapshot.secondary = {
      usedPercent: sw.used_percent,
      windowMinutes: Math.ceil(sw.limit_window_seconds / 60),
      resetsAt: sw.reset_at,
    };
  }

  if (response.credits) {
    snapshot.credits = {
      hasCredits: response.credits.has_credits,
      unlimited: response.credits.unlimited,
      balance: response.credits.balance ?? undefined,
    };
  }

  return snapshot;
}

export async function fetchRateLimits(
  accessToken: string,
  accountId?: string
): Promise<RateLimitSnapshot> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'User-Agent': 'opencode-openai-auth-rotator',
  };

  if (accountId) {
    headers['ChatGPT-Account-Id'] = accountId;
  }

  const url = `${API.CHATGPT_BASE}${API.USAGE_ENDPOINT}`;

  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`Failed to fetch rate limits: ${response.status}`);
  }

  const data = await response.json() as RateLimitStatusResponse;
  return parseRateLimitResponse(data);
}

export async function fetchRateLimitsForAccount(
  account: CodexAccount
): Promise<{ rateLimits: RateLimitSnapshot; updatedTokens?: CodexAccount['tokens'] }> {
  let tokens = account.tokens;
  let updatedTokens: CodexAccount['tokens'] | undefined;

  if (isTokenExpired(tokens.expiresAt) && tokens.refreshToken) {
    tokens = await refreshTokens(tokens.refreshToken);
    updatedTokens = tokens;
  }

  const rateLimits = await fetchRateLimits(tokens.accessToken, account.accountId);
  return { rateLimits, updatedTokens };
}

export function createQuotaDisplayInfo(
  account: CodexAccount,
  now: number = Date.now()
): QuotaDisplayInfo {
  const rateLimits = account.rateLimits;
  const lastUpdated = account.rateLimitsUpdatedAt;
  const isStale = lastUpdated
    ? now - lastUpdated > CODEX_AUTH_CONSTANTS.STALE_THRESHOLD_MS
    : true;

  const info: QuotaDisplayInfo = {
    accountName: account.name,
    planType: rateLimits?.planType,
    isStale,
    lastUpdated: lastUpdated ? new Date(lastUpdated) : undefined,
  };

  if (rateLimits?.primary) {
    const p = rateLimits.primary;
    const label = formatDuration(p.windowMinutes ?? CODEX_AUTH_CONSTANTS.PRIMARY_WINDOW_MINUTES);
    info.primary = {
      label: `${label} limit`,
      usedPercent: p.usedPercent,
      remainingPercent: Math.max(0, 100 - p.usedPercent),
      resetsAt: p.resetsAt ? new Date(p.resetsAt * 1000) : undefined,
    };
  }

  if (rateLimits?.secondary) {
    const s = rateLimits.secondary;
    const label = formatDuration(s.windowMinutes ?? CODEX_AUTH_CONSTANTS.SECONDARY_WINDOW_MINUTES);
    info.secondary = {
      label: `${label} limit`,
      usedPercent: s.usedPercent,
      remainingPercent: Math.max(0, 100 - s.usedPercent),
      resetsAt: s.resetsAt ? new Date(s.resetsAt * 1000) : undefined,
    };
  }

  if (rateLimits?.credits) {
    const c = rateLimits.credits;
    info.credits = {
      hasCredits: c.hasCredits,
      unlimited: c.unlimited,
      balance: c.balance ? parseFloat(c.balance) : undefined,
    };
  }

  return info;
}

export function formatQuotaStatus(info: QuotaDisplayInfo): string {
  const lines: string[] = [];
  
  lines.push(`Account: ${info.accountName}${info.planType ? ` (${info.planType})` : ''}`);

  if (info.primary) {
    const p = info.primary;
    const resetStr = p.resetsAt ? ` (resets ${formatResetTime(p.resetsAt.getTime() / 1000)})` : '';
    lines.push(`${p.label}: ${p.remainingPercent.toFixed(0)}% left${resetStr}`);
  }

  if (info.secondary) {
    const s = info.secondary;
    const resetStr = s.resetsAt ? ` (resets ${formatResetTime(s.resetsAt.getTime() / 1000)})` : '';
    lines.push(`${s.label}: ${s.remainingPercent.toFixed(0)}% left${resetStr}`);
  }

  if (info.credits?.hasCredits) {
    if (info.credits.unlimited) {
      lines.push('Credits: Unlimited');
    } else if (info.credits.balance !== undefined) {
      lines.push(`Credits: ${Math.round(info.credits.balance)}`);
    }
  }

  if (info.isStale) {
    lines.push('⚠ Data may be stale');
  }

  return lines.join('\n');
}

export function shouldRotateAccount(rateLimits: RateLimitSnapshot | undefined, threshold: number): boolean {
  if (!rateLimits) return false;

  if (rateLimits.primary && rateLimits.primary.usedPercent >= threshold) {
    return true;
  }

  if (rateLimits.secondary && rateLimits.secondary.usedPercent >= threshold) {
    return true;
  }

  return false;
}
