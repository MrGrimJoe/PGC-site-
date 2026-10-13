import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../worker/index.ts';
import { createSqliteD1 } from '../worker/db/sqlite-d1.ts';
import { runMigrations } from '../worker/db/migrate.ts';
import { encodeOAuthState } from '../worker/auth.ts';
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
    };
  });

  it('GET /api/auth/google initiates PKCE flow and sets oauth_state cookie', async () => {
    const req = new Request('http://localhost:3000/api/auth/google', { method: 'GET' });
    const res = await worker.fetch(req, env);

    expect(res.status).toBe(302);
    const location = res.headers.get('Location');
    expect(location).toBeDefined();
    expect(location).toContain('https://accounts.google.com/o/oauth2/v2/auth');
    expect(location).toContain('code_challenge=');
    expect(location).toContain('code_challenge_method=S256');
    expect(location).toContain('state=');
    expect(location).toContain('nonce=');

    // Verify Set-Cookie has HttpOnly, Secure, SameSite=Lax
    const setCookie = res.headers.get('Set-Cookie');
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain('oauth_state=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Lax');
  });

  it('auth callback with a bad state is rejected with 400', async () => {
    // Legitimate state in cookie
    const validCookieState = 'valid_secret_state_123';
    const cookiePayload = encodeOAuthState({
      state: validCookieState,
      codeVerifier: 'verifier_string_abcdef',
      nonce: 'nonce_secret_xyz',
      createdAt: Date.now(),
    });

    // Request with bad/tampered state
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

  it('auth callback with matching state completes login and establishes session', async () => {
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

    // Verify session cookie was set
    const setCookie = res.headers.get('Set-Cookie');
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain('session_id=sess_');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Lax');

    // Verify user was inserted into D1
    const users = await env.DB.prepare('SELECT * FROM users').all();
    expect(users.results.length).toBe(1);

    const profiles = await env.DB.prepare('SELECT * FROM profiles').all();
    expect(profiles.results.length).toBe(1);

    const settings = await env.DB.prepare('SELECT * FROM user_settings').all();
    expect(settings.results.length).toBe(1);

    const sessions = await env.DB.prepare('SELECT * FROM sessions').all();
    expect(sessions.results.length).toBe(1);
  });

  it('POST /api/auth/logout deletes the session and clears session cookie', async () => {
    // Create a user and session in D1
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

    // Call logout
    const req = new Request('http://localhost:3000/api/auth/logout', {
      method: 'POST',
      headers: {
        Cookie: 'session_id=sess_active_123',
      },
    });

    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);

    // Verify session deleted from D1
    const checkSession = await env.DB.prepare('SELECT * FROM sessions WHERE id = ?')
      .bind('sess_active_123')
      .first();
    expect(checkSession).toBeNull();

    // Verify cookie cleared
    const setCookie = res.headers.get('Set-Cookie');
    expect(setCookie).toContain('Max-Age=0');
  });
});
