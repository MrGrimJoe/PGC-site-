import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../worker/index.ts';
import { createSqliteD1 } from '../worker/db/sqlite-d1.ts';
import { runMigrations } from '../worker/db/migrate.ts';
import { encodeOAuthState, base64UrlEncode, verifyGoogleIdToken } from '../worker/auth.ts';
import type { Env } from '../worker/types.ts';

describe('Google OAuth & Session Authentication', () => {
  let env: Env;

  beforeEach(async () => {
    const db = createSqliteD1(':memory:');
    await runMigrations(db);
    env = {
      DB: db,
      APP_URL: 'http://localhost:3000',
      GOOGLE_CLIENT_ID: 'test-google-client-id.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
      ENVIRONMENT: 'development',
    };
  });

  // DEV-ONLY: remove before launch
  it('GET /api/auth/google initiates PKCE flow and sets cookie without Secure flag in development', async () => {
    const req = new Request('http://localhost:3000/api/auth/google', { method: 'GET' });
    const res = await worker.fetch(req, env);

    expect(res.status).toBe(302);
    const location = res.headers.get('Location');
    expect(location).toBeDefined();
    expect(location).toContain('code_challenge=');
    expect(location).toContain('code_challenge_method=S256');
    expect(location).toContain('state=');
    expect(location).toContain('nonce=');

    // In development: HttpOnly & SameSite=Lax present, but NOT Secure (so Safari on http://localhost accepts it)
    const setCookie = res.headers.get('Set-Cookie');
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain('oauth_state=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).not.toContain('Secure');
  });

  it('GET /api/auth/google sets Secure flag on cookies in production', async () => {
    const prodEnv: Env = {
      ...env,
      ENVIRONMENT: 'production',
      GOOGLE_CLIENT_ID: 'real-client-id.apps.googleusercontent.com',
    };

    const req = new Request('http://localhost:3000/api/auth/google', { method: 'GET' });
    const res = await worker.fetch(req, prodEnv);

    expect(res.status).toBe(302);
    const setCookie = res.headers.get('Set-Cookie');
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain('oauth_state=');
    expect(setCookie).toContain('Secure');
  });

  // DEV-ONLY: remove before launch
  it('rejects mock auth in /api/auth/google when ENVIRONMENT is production', async () => {
    const prodEnv: Env = {
      ...env,
      ENVIRONMENT: 'production',
      GOOGLE_CLIENT_ID: 'real-client-id.apps.googleusercontent.com',
    };

    const req = new Request('http://localhost:3000/api/auth/google?mock=true', { method: 'GET' });
    const res = await worker.fetch(req, prodEnv);

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Mock authentication is disabled in production');
  });

  // DEV-ONLY: remove before launch
  it('rejects mock code in /api/auth/callback when ENVIRONMENT is production', async () => {
    const prodEnv: Env = {
      ...env,
      ENVIRONMENT: 'production',
      GOOGLE_CLIENT_ID: 'real-client-id.apps.googleusercontent.com',
    };

    const legitimateState = 'valid_matching_state_456';
    const cookiePayload = encodeOAuthState({
      state: legitimateState,
      codeVerifier: 'verifier_string_abcdef',
      nonce: 'nonce_123',
      createdAt: Date.now(),
    });

    const callbackUrl = `http://localhost:3000/api/auth/callback?code=mock_code&state=${legitimateState}&mock=true`;
    const req = new Request(callbackUrl, {
      method: 'GET',
      headers: {
        Cookie: `oauth_state=${cookiePayload}`,
      },
    });

    const res = await worker.fetch(req, prodEnv);

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Mock authorization is disabled in production');
  });

  it('auth callback with a bad state is rejected with 400', async () => {
    const validCookieState = 'valid_secret_state_123';
    const cookiePayload = encodeOAuthState({
      state: validCookieState,
      codeVerifier: 'verifier_string_abcdef',
      nonce: 'nonce_secret_xyz',
      createdAt: Date.now(),
    });

    const badStateUrl = 'http://localhost:3000/api/auth/callback?code=some_code&state=bad_tampered_state';
    const req = new Request(badStateUrl, {
      method: 'GET',
      headers: {
        Cookie: `oauth_state=${cookiePayload}`,
      },
    });

    const res = await worker.fetch(req, env);

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Invalid OAuth state parameter');
  });

  it('auth callback with missing state cookie is rejected with 400', async () => {
    const req = new Request('http://localhost:3000/api/auth/callback?code=some_code&state=any_state', {
      method: 'GET',
    });

    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Missing OAuth state cookie');
  });

  // DEV-ONLY: remove before launch
  it('auth callback in development creates account with random username and unsets Secure cookie flag', async () => {
    const legitimateState = 'valid_matching_state_456';
    const nonce = 'nonce_123456789';
    const cookiePayload = encodeOAuthState({
      state: legitimateState,
      codeVerifier: 'verifier_string_abcdef',
      nonce,
      createdAt: Date.now(),
    });

    const callbackUrl = `http://localhost:3000/api/auth/callback?code=mock_code&state=${legitimateState}&mock=true`;
    const req = new Request(callbackUrl, {
      method: 'GET',
      headers: {
        Cookie: `oauth_state=${cookiePayload}`,
      },
    });

    const res = await worker.fetch(req, env);

    expect(res.status).toBe(302);

    // Verify session cookie without Secure flag in development
    const setCookie = res.headers.get('Set-Cookie');
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain('session_id=sess_');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).not.toContain('Secure');

    // Verify user was inserted into D1
    const users = await env.DB.prepare('SELECT * FROM users').all();
    expect(users.results.length).toBe(1);

    // Verify random username format (user_ + 6 chars) and not derived from email
    const profile = await env.DB.prepare('SELECT * FROM profiles').first<{ username: string }>();
    expect(profile?.username).toMatch(/^user_[a-z0-9]{6}$/);

    const sessions = await env.DB.prepare('SELECT * FROM sessions').all();
    expect(sessions.results.length).toBe(1);
  });

  it('verifyGoogleIdToken requires email_verified', async () => {
    const header = base64UrlEncode(JSON.stringify({ alg: 'none' }));
    const payloadUnverified = base64UrlEncode(
      JSON.stringify({
        iss: 'https://accounts.google.com',
        aud: 'client-123',
        sub: 'sub-123',
        nonce: 'nonce-123',
        exp: Math.floor(Date.now() / 1000) + 3600,
        email_verified: false,
      })
    );
    const fakeToken = `${header}.${payloadUnverified}.signature`;

    await expect(
      verifyGoogleIdToken(fakeToken, 'client-123', 'nonce-123', { allowTestBypass: true })
    ).rejects.toThrow('Email address is not verified');

    // Verified email succeeds
    const payloadVerified = base64UrlEncode(
      JSON.stringify({
        iss: 'https://accounts.google.com',
        aud: 'client-123',
        sub: 'sub-123',
        nonce: 'nonce-123',
        exp: Math.floor(Date.now() / 1000) + 3600,
        email_verified: true,
      })
    );
    const verifiedToken = `${header}.${payloadVerified}.signature`;

    const result = await verifyGoogleIdToken(verifiedToken, 'client-123', 'nonce-123', {
      allowTestBypass: true,
    });
    expect(result.sub).toBe('sub-123');
  });

  it('POST /api/auth/logout deletes the session and clears session cookie', async () => {
    await env.DB.prepare(
      'INSERT INTO users (id, provider_subject, created_at, status) VALUES (?, ?, ?, ?)'
    )
      .bind('usr_1', 'sub_1', new Date().toISOString(), 'active')
      .run();

    await env.DB.prepare(
      'INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)'
    )
      .bind('sess_active_123', 'usr_1', new Date(Date.now() + 86400000).toISOString())
      .run();

    const req = new Request('http://localhost:3000/api/auth/logout', {
      method: 'POST',
      headers: {
        Cookie: 'session_id=sess_active_123',
      },
    });

    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);

    const checkSession = await env.DB.prepare('SELECT * FROM sessions WHERE id = ?')
      .bind('sess_active_123')
      .first();
    expect(checkSession).toBeNull();

    const setCookie = res.headers.get('Set-Cookie');
    expect(setCookie).toContain('Max-Age=0');
  });
});
