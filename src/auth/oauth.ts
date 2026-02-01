import * as http from 'node:http';
import * as url from 'node:url';
import type { OAuthTokens } from '../types.js';
import { CODEX_AUTH_CONSTANTS } from '../types.js';
import { generateCodeVerifier, generateCodeChallenge, generateState } from '../utils/crypto.js';

const OAUTH = CODEX_AUTH_CONSTANTS.OAUTH;
const CALLBACK_PORT = 8976;
const CALLBACK_TIMEOUT_MS = 300000;

interface AuthorizationResult {
  code: string;
  state: string;
}

export function buildAuthorizationUrl(codeChallenge: string, state: string): string {
  const params = new URLSearchParams({
    client_id: OAUTH.CLIENT_ID,
    redirect_uri: OAUTH.REDIRECT_URI,
    response_type: 'code',
    scope: OAUTH.SCOPE,
    audience: OAUTH.AUDIENCE,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state: state,
  });

  return `${OAUTH.AUTH_URL}?${params.toString()}`;
}

async function exchangeCodeForTokens(code: string, codeVerifier: string): Promise<OAuthTokens> {
  const response = await fetch(OAUTH.TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: OAUTH.CLIENT_ID,
      code_verifier: codeVerifier,
      code: code,
      redirect_uri: OAUTH.REDIRECT_URI,
    }).toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
  }

  const data = await response.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    token_type: string;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
    tokenType: data.token_type,
  };
}

export async function refreshTokens(refreshToken: string): Promise<OAuthTokens> {
  const response = await fetch(OAUTH.TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: OAUTH.CLIENT_ID,
      refresh_token: refreshToken,
    }).toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token refresh failed: ${response.status} ${errorText}`);
  }

  const data = await response.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    token_type: string;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
    tokenType: data.token_type,
  };
}

function startCallbackServer(expectedState: string): Promise<AuthorizationResult> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const parsedUrl = url.parse(req.url || '', true);

      if (parsedUrl.pathname !== '/callback') {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }

      const code = parsedUrl.query['code'] as string | undefined;
      const state = parsedUrl.query['state'] as string | undefined;
      const error = parsedUrl.query['error'] as string | undefined;

      if (error) {
        const errorDesc = parsedUrl.query['error_description'] as string || error;
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(getErrorHtml(errorDesc));
        server.close();
        reject(new Error(`OAuth error: ${errorDesc}`));
        return;
      }

      if (!code || !state) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(getErrorHtml('Missing code or state'));
        server.close();
        reject(new Error('Missing code or state in callback'));
        return;
      }

      if (state !== expectedState) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(getErrorHtml('State mismatch'));
        server.close();
        reject(new Error('State mismatch - possible CSRF attack'));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(getSuccessHtml());
      server.close();
      resolve({ code, state });
    });

    const timeout = setTimeout(() => {
      server.close();
      reject(new Error('Authorization timeout'));
    }, CALLBACK_TIMEOUT_MS);

    server.on('close', () => clearTimeout(timeout));

    server.listen(CALLBACK_PORT, '127.0.0.1');

    server.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to start callback server: ${err.message}`));
    });
  });
}

function getSuccessHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Authorization Successful</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
    .container { text-align: center; background: white; padding: 40px; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .success { color: #10b981; font-size: 48px; margin-bottom: 16px; }
    h1 { color: #111; margin: 0 0 8px 0; }
    p { color: #666; margin: 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="success">✓</div>
    <h1>Authorization Successful</h1>
    <p>You can close this window and return to OpenCode.</p>
  </div>
</body>
</html>`;
}

function getErrorHtml(message: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Authorization Failed</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
    .container { text-align: center; background: white; padding: 40px; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .error { color: #ef4444; font-size: 48px; margin-bottom: 16px; }
    h1 { color: #111; margin: 0 0 8px 0; }
    p { color: #666; margin: 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="error">✕</div>
    <h1>Authorization Failed</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}

export interface LoginResult {
  tokens: OAuthTokens;
  userInfo?: {
    email?: string;
    name?: string;
    sub?: string;
  };
}

export async function performLogin(): Promise<LoginResult> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();

  const authUrl = buildAuthorizationUrl(codeChallenge, state);

  const serverPromise = startCallbackServer(state);

  const open = await import('open');
  await open.default(authUrl);

  const { code } = await serverPromise;

  const tokens = await exchangeCodeForTokens(code, codeVerifier);

  let userInfo: LoginResult['userInfo'];
  try {
    userInfo = await fetchUserInfo(tokens.accessToken);
  } catch {
    userInfo = undefined;
  }

  return { tokens, userInfo };
}

async function fetchUserInfo(accessToken: string): Promise<LoginResult['userInfo']> {
  const response = await fetch('https://auth.openai.com/userinfo', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch user info: ${response.status}`);
  }

  const data = await response.json() as {
    email?: string;
    name?: string;
    sub?: string;
  };

  return data;
}

export function isTokenExpired(expiresAt?: number): boolean {
  if (!expiresAt) return false;
  return Date.now() >= expiresAt - 60000;
}
