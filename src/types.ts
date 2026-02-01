/**
 * Type definitions for OpenCode OpenAI Auth Rotator
 */

// ============================================================================
// Plan Types
// ============================================================================

export type PlanType =
  | 'Free'
  | 'Go'
  | 'Plus'
  | 'Pro'
  | 'Team'
  | 'Business'
  | 'Enterprise'
  | 'Edu'
  | 'Unknown';

// ============================================================================
// Rate Limit Types
// ============================================================================

export interface RateLimitWindow {
  /** Percentage of limit used (0-100) */
  usedPercent: number;
  /** Window duration in minutes (300 = 5h, 10080 = 1 week) */
  windowMinutes?: number;
  /** Unix timestamp when the window resets */
  resetsAt?: number;
}

export interface CreditsSnapshot {
  /** Whether the account has credit tracking enabled */
  hasCredits: boolean;
  /** Whether credits are unlimited */
  unlimited: boolean;
  /** Credit balance as string (e.g., "1234" or "1234.56") */
  balance?: string;
}

export interface RateLimitSnapshot {
  /** Primary rate limit window (typically 5-hour) */
  primary?: RateLimitWindow;
  /** Secondary rate limit window (typically weekly) */
  secondary?: RateLimitWindow;
  /** Credit information */
  credits?: CreditsSnapshot;
  /** User's plan type */
  planType?: PlanType;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface RateLimitWindowResponse {
  used_percent: number;
  limit_window_seconds: number;
  reset_at: number;
}

export interface CreditStatusResponse {
  has_credits: boolean;
  unlimited: boolean;
  balance?: string | null;
}

export interface RateLimitStatusResponse {
  plan_type: string;
  rate_limit?: {
    primary_window?: RateLimitWindowResponse | null;
    secondary_window?: RateLimitWindowResponse | null;
  } | null;
  credits?: CreditStatusResponse | null;
}

// ============================================================================
// OAuth Types
// ============================================================================

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType: string;
}

export interface OAuthConfig {
  clientId: string;
  authUrl: string;
  tokenUrl: string;
  redirectUri: string;
  scope: string;
}

// ============================================================================
// Account Types
// ============================================================================

export interface CodexAccount {
  /** Unique identifier for this account */
  id: string;
  /** Display name or email */
  name: string;
  /** OAuth tokens */
  tokens: OAuthTokens;
  /** ChatGPT account ID (for multi-account headers) */
  accountId?: string;
  /** Cached rate limit snapshot */
  rateLimits?: RateLimitSnapshot;
  /** Last time rate limits were fetched */
  rateLimitsUpdatedAt?: number;
  /** Account creation timestamp */
  createdAt: number;
  /** Last used timestamp */
  lastUsedAt?: number;
}

export interface CodexAuthStorage {
  /** Schema version for migrations */
  version: number;
  /** ID of the currently active account */
  currentAccountId?: string;
  /** All stored accounts */
  accounts: CodexAccount[];
  /** Global settings */
  settings: CodexAuthSettings;
}

export interface CodexAuthSettings {
  /** Auto-rotate when usage exceeds this threshold (0-100) */
  rotationThreshold: number;
  /** Check quota before each request */
  checkQuotaBeforeRequest: boolean;
  /** Refresh rate limits interval in ms (default: 5 minutes) */
  rateLimitRefreshInterval: number;
}

// ============================================================================
// Plugin Integration Types
// ============================================================================

export interface QuotaDisplayInfo {
  /** Account display name */
  accountName: string;
  /** Plan type */
  planType?: PlanType;
  /** Primary window info */
  primary?: {
    label: string;
    usedPercent: number;
    remainingPercent: number;
    resetsAt?: Date;
  };
  /** Secondary window info */
  secondary?: {
    label: string;
    usedPercent: number;
    remainingPercent: number;
    resetsAt?: Date;
  };
  /** Credits info */
  credits?: {
    hasCredits: boolean;
    unlimited: boolean;
    balance?: number;
  };
  /** Whether data is stale (>15 minutes old) */
  isStale: boolean;
  /** Last update time */
  lastUpdated?: Date;
}

export interface RotationResult {
  /** Whether rotation occurred */
  rotated: boolean;
  /** Previous account ID */
  previousAccountId?: string;
  /** New account ID */
  newAccountId?: string;
  /** Reason for rotation (or why it didn't happen) */
  reason: string;
}

// ============================================================================
// Constants
// ============================================================================

export const CODEX_AUTH_CONSTANTS = {
  /** Storage file path relative to config dir */
  STORAGE_FILENAME: 'codex_auth.json',
  
  /** OpenCode auth.json path for sync */
  OPENCODE_AUTH_PATH: 'auth.json',
  
  /** Default rotation threshold (90%) */
  DEFAULT_ROTATION_THRESHOLD: 90,
  
  /** Rate limit stale threshold in ms (15 minutes) */
  STALE_THRESHOLD_MS: 15 * 60 * 1000,
  
  /** Default rate limit refresh interval (5 minutes) */
  DEFAULT_REFRESH_INTERVAL_MS: 5 * 60 * 1000,
  
  /** Primary window duration in minutes (5 hours) */
  PRIMARY_WINDOW_MINUTES: 300,
  
  /** Secondary window duration in minutes (1 week) */
  SECONDARY_WINDOW_MINUTES: 10080,
  
  /** OAuth configuration for Codex */
  OAUTH: {
    CLIENT_ID: 'pdlLIX2Y72MIl2rhLhTE9VV9bN905kBh',
    AUTH_URL: 'https://auth.openai.com/authorize',
    TOKEN_URL: 'https://auth.openai.com/oauth/token',
    REDIRECT_URI: 'http://127.0.0.1:8976/callback',
    SCOPE: 'openid profile email offline_access',
    AUDIENCE: 'https://api.openai.com/v1',
  },
  
  /** API endpoints */
  API: {
    /** Base URL for ChatGPT backend */
    CHATGPT_BASE: 'https://chatgpt.com/backend-api',
    /** Usage endpoint (WHAM style) */
    USAGE_ENDPOINT: '/wham/usage',
  },
} as const;
