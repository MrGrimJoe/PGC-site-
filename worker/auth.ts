import type { D1Database } from '@cloudflare/workers-types';
import type { OAuthStatePayload, UserRow, ProfileRow, UserSettingsRow } from './types.ts';

/**
 * Cookie parsing utility
 */
export function parseCookies(cookieHeader: string | null): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;

  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    try {
      cookies[key] = decodeURIComponent(val);
    } catch {
      cookies[key] = val;
    }
  }
  return cookies;
}

/**
 * Cookie serializer utility enforcing HttpOnly, Secure, SameSite=Lax
 */
export function serializeCookie(
  name: string,
  value: string,
  options: {
    maxAge?: number;
    path?: string;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'Lax' | 'Strict' | 'None';
  } = {}
): string {
  const parts: string[] = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`];

  const path = options.path ?? '/';
  parts.push(`Path=${path}`);

  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${options.maxAge}`);
  }

  // Enforce HttpOnly by default
  if (options.httpOnly !== false) {
    parts.push('HttpOnly');
  }

  // Enforce Secure by default
  if (options.secure !== false) {
    parts.push('Secure');
  }

  const sameSite = options.sameSite ?? 'Lax';
  parts.push(`SameSite=${sameSite}`);

  return parts.join('; ');
}

/**
 * Generate cryptographically secure base64url random string
 */
export function generateRandomString(bytesCount = 32): string {
  const bytes = new Uint8Array(bytesCount);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/**
 * Base64URL encoder
 */
export function base64UrlEncode(data: Uint8Array | string): string {
  let binary = '';
  if (typeof data === 'string') {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(data);
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]!);
    }
  } else {
    for (let i = 0; i < data.length; i++) {
      binary += String.fromCharCode(data[i]!);
    }
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Base64URL decoder
 */
export function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return atob(base64);
}

/**
 * Generate PKCE code challenge from verifier using SHA-256
 */
export async function generateCodeChallenge(codeVerifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
}

/**
 * Encode OAuth state payload into secure cookie value
 */
export function encodeOAuthState(payload: OAuthStatePayload): string {
  const json = JSON.stringify(payload);
  return base64UrlEncode(json);
}

/**
 * Decode and validate OAuth state payload from cookie
 */
export function decodeOAuthState(str: string): OAuthStatePayload | null {
  try {
    const json = base64UrlDecode(str);
    const parsed = JSON.parse(json) as OAuthStatePayload;
    if (!parsed.state || !parsed.codeVerifier || !parsed.nonce) {
      return null;
    }
    // Check if expired (10 minutes)
    if (Date.now() - parsed.createdAt > 10 * 60 * 1000) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Google ID Token payload structure
 */
export interface GoogleIdTokenPayload {
  iss: string;
  sub: string;
  aud: string;
  exp: number;
  iat: number;
  nonce?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  given_name?: string;
  family_name?: string;
}

/**
 * Verifies Google ID token claims and nonce.
 */
export async function verifyGoogleIdToken(
  idToken: string,
  expectedClientId: string,
  expectedNonce: string
): Promise<GoogleIdTokenPayload> {
  const parts = idToken.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed ID token');
  }

  const payloadJson = base64UrlDecode(parts[1]!);
  const payload: GoogleIdTokenPayload = JSON.parse(payloadJson);

  // 1. Verify issuer
  const validIssuers = ['https://accounts.google.com', 'accounts.google.com'];
  if (!validIssuers.includes(payload.iss)) {
    throw new Error(`Invalid ID token issuer: ${payload.iss}`);
  }

  // 2. Verify audience
  if (payload.aud !== expectedClientId) {
    throw new Error(`Invalid ID token audience: expected ${expectedClientId}, got ${payload.aud}`);
  }

  // 3. Verify nonce
  if (!payload.nonce || payload.nonce !== expectedNonce) {
    throw new Error('ID token nonce mismatch');
  }

  // 4. Verify expiration
  const nowInSeconds = Math.floor(Date.now() / 1000);
  if (payload.exp < nowInSeconds) {
    throw new Error('ID token has expired');
  }

  return payload;
}

/**
 * Authentication Context for an authenticated request
 */
export interface AuthenticatedUser {
  user: UserRow;
  profile: ProfileRow;
  settings: UserSettingsRow;
  sessionId: string;
}

/**
 * Look up active user session from Cookie header
 */
export async function authenticateRequest(
  request: Request,
  db: D1Database
): Promise<AuthenticatedUser | null> {
  const cookieHeader = request.headers.get('Cookie');
  const cookies = parseCookies(cookieHeader);
  const sessionId = cookies['session_id'];

  if (!sessionId) {
    return null;
  }

  // Parameterized query looking up session and user
  const sessionRow = await db
    .prepare(
      `SELECT s.id, s.user_id, s.expires_at, u.created_at, u.status, u.provider_subject
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ?`
    )
    .bind(sessionId)
    .first<{
      id: string;
      user_id: string;
      expires_at: string;
      created_at: string;
      status: string;
      provider_subject: string;
    }>();

  if (!sessionRow) {
    return null;
  }

  // Check if session has expired
  const now = new Date();
  if (new Date(sessionRow.expires_at) < now) {
    // Delete expired session
    await db.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
    return null;
  }

  // Check if user status is active
  if (sessionRow.status !== 'active') {
    return null;
  }

  // Fetch profile
  const profileRow = await db
    .prepare('SELECT * FROM profiles WHERE user_id = ?')
    .bind(sessionRow.user_id)
    .first<ProfileRow>();

  // Fetch settings
  const settingsRow = await db
    .prepare('SELECT * FROM user_settings WHERE user_id = ?')
    .bind(sessionRow.user_id)
    .first<UserSettingsRow>();

  if (!profileRow) {
    return null;
  }

  return {
    user: {
      id: sessionRow.user_id,
      provider_subject: sessionRow.provider_subject,
      created_at: sessionRow.created_at,
      status: sessionRow.status,
    },
    profile: profileRow,
    settings: settingsRow ?? {
      user_id: sessionRow.user_id,
      dm_policy: 'everyone',
      feed_preferences: '{}',
    },
    sessionId,
  };
}
