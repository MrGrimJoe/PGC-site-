import type { ExecutionContext, D1PreparedStatement } from '@cloudflare/workers-types';
import type { Env, ProfileRow, UserRow, UserSettingsRow } from './types.ts';
import {
  authenticateRequest,
  decodeOAuthState,
  encodeOAuthState,
  generateCodeChallenge,
  generateRandomString,
  parseCookies,
  serializeCookie,
  verifyGoogleIdToken,
} from './auth.ts';
import { normalizeUsername } from '../shared/username.ts';
import { updateProfileSchema } from '../shared/schema.ts';

function jsonResponse(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

function generateRandomUsername(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += chars[bytes[i]! % chars.length];
  }
  return `user_${suffix}`;
}

export default {
  async fetch(request: Request, env: Env, _ctx?: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method.toUpperCase();
    const isDevelopment = env.ENVIRONMENT === 'development';
    const isHttps = url.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';

    // DEV-ONLY: remove before launch
    // In development:
    // - On HTTPS (e.g. AI Studio preview in an iframe), use SameSite=None; Secure; Partitioned so cookies work in third-party contexts.
    // - On HTTP (e.g. http://localhost), use SameSite=Lax without Secure so Safari doesn't drop unencrypted cookies.
    // In production:
    // - Always enforce Secure; HttpOnly; SameSite=Lax.
    const cookieSecure = isDevelopment ? isHttps : true;
    const cookieSameSite = isDevelopment && isHttps ? ('None' as const) : ('Lax' as const);
    const cookiePartitioned = isDevelopment && isHttps;

    // CORS / preflight
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': env.APP_URL || url.origin,
          'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Cookie',
          'Access-Control-Allow-Credentials': 'true',
        },
      });
    }

    // 1. GET /api/auth/google - Initiate Google Sign-In with PKCE
    if (pathname === '/api/auth/google' && method === 'GET') {
      // DEV-ONLY: remove before launch
      // The mock login path (mock=true / PLACEHOLDER client ID) works ONLY when env.ENVIRONMENT === 'development'
      const isMockRequested =
        url.searchParams.get('mock') === 'true' || env.GOOGLE_CLIENT_ID === 'PLACEHOLDER';

      if (isMockRequested && !isDevelopment) {
        return jsonResponse({ error: 'Mock authentication is disabled in production' }, 400);
      }

      const state = generateRandomString(24);
      const nonce = generateRandomString(24);
      const codeVerifier = generateRandomString(32);
      const codeChallenge = await generateCodeChallenge(codeVerifier);

      const redirectUri = `${env.APP_URL || url.origin}/api/auth/callback`;

      const oauthState = encodeOAuthState({
        state,
        codeVerifier,
        nonce,
        createdAt: Date.now(),
      });

      const googleAuthUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      googleAuthUrl.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
      googleAuthUrl.searchParams.set('redirect_uri', redirectUri);
      googleAuthUrl.searchParams.set('response_type', 'code');
      googleAuthUrl.searchParams.set('scope', 'openid email profile');
      googleAuthUrl.searchParams.set('state', state);
      googleAuthUrl.searchParams.set('nonce', nonce);
      googleAuthUrl.searchParams.set('code_challenge', codeChallenge);
      googleAuthUrl.searchParams.set('code_challenge_method', 'S256');
      googleAuthUrl.searchParams.set('prompt', 'select_account');

      // DEV-ONLY: remove before launch
      // When ENVIRONMENT === 'development', use a relative Location header so the oauth_state cookie
      // is always sent regardless of differences between APP_URL and the browser's host (e.g. preview proxy).
      const targetUrl =
        isMockRequested && isDevelopment
          ? `/api/auth/callback?code=mock_code&state=${encodeURIComponent(state)}&mock=true`
          : googleAuthUrl.toString();

      return new Response(null, {
        status: 302,
        headers: {
          Location: targetUrl,
          'Set-Cookie': serializeCookie('oauth_state', oauthState, {
            path: '/',
            maxAge: 600, // 10 minutes
            httpOnly: true,
            secure: cookieSecure,
            sameSite: cookieSameSite,
            partitioned: cookiePartitioned,
          }),
        },
      });
    }

    // 2. GET /api/auth/callback - Handle OAuth callback, verify state & nonce, set session cookie
    if (pathname === '/api/auth/callback' && method === 'GET') {
      const code = url.searchParams.get('code');
      const stateParam = url.searchParams.get('state');
      const errorParam = url.searchParams.get('error');

      if (errorParam) {
        return jsonResponse({ error: 'Authentication failed' }, 400);
      }

      // DEV-ONLY: remove before launch
      const isMockCode = url.searchParams.get('mock') === 'true' || (code ? code.startsWith('mock_') : false);

      if (isMockCode && !isDevelopment) {
        return jsonResponse({ error: 'Mock authorization is disabled in production' }, 400);
      }

      const cookies = parseCookies(request.headers.get('Cookie'));
      const rawOAuthCookie = cookies['oauth_state'];

      let oauthState = rawOAuthCookie ? decodeOAuthState(rawOAuthCookie) : null;

      // DEV-ONLY: remove before launch
      // If the browser/iframe blocked the transient oauth_state cookie during development mock login,
      // fallback to creating the mock state so developer workflow is never blocked in third-party iframes.
      if (!oauthState && isDevelopment && isMockCode) {
        oauthState = {
          state: stateParam || 'mock_state',
          codeVerifier: 'mock_verifier',
          nonce: stateParam || 'mock_nonce',
          createdAt: Date.now(),
        };
      }

      if (!rawOAuthCookie && (!isDevelopment || !isMockCode)) {
        return jsonResponse({ error: 'Missing OAuth state cookie' }, 400);
      }

      if (!oauthState) {
        return jsonResponse({ error: 'Invalid or expired OAuth state cookie' }, 400);
      }

      // Strict state verification: bad state must be rejected with 400
      if (!stateParam || stateParam !== oauthState.state) {
        return jsonResponse({ error: 'Invalid OAuth state parameter' }, 400);
      }

      if (!code) {
        return jsonResponse({ error: 'Missing authorization code' }, 400);
      }

      const redirectUri = `${env.APP_URL || url.origin}/api/auth/callback`;
      let providerSubject = '';

      // DEV-ONLY: remove before launch
      if (isMockCode) {
        providerSubject = `google_mock_sub_${oauthState.nonce.slice(0, 12)}`;
      } else {
        // Exchange authorization code with PKCE verifier at Google token endpoint
        let tokenResponse: globalThis.Response;
        try {
          tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              client_id: env.GOOGLE_CLIENT_ID,
              client_secret: env.GOOGLE_CLIENT_SECRET,
              code,
              code_verifier: oauthState.codeVerifier,
              grant_type: 'authorization_code',
              redirect_uri: redirectUri,
            }),
          });
        } catch {
          return jsonResponse({ error: 'Authentication failed' }, 400);
        }

        if (!tokenResponse.ok) {
          return jsonResponse({ error: 'Authentication failed' }, 400);
        }

        const tokenData = (await tokenResponse.json()) as { id_token?: string; access_token?: string };
        if (!tokenData.id_token) {
          return jsonResponse({ error: 'Authentication failed' }, 400);
        }

        // Verify ID token signature against Google JWKS and require email_verified
        try {
          const idTokenPayload = await verifyGoogleIdToken(
            tokenData.id_token,
            env.GOOGLE_CLIENT_ID,
            oauthState.nonce
          );
          providerSubject = idTokenPayload.sub;
        } catch {
          return jsonResponse({ error: 'Authentication failed' }, 400);
        }
      }

      // Check if user already exists
      const existingUser = await env.DB.prepare('SELECT * FROM users WHERE provider_subject = ?')
        .bind(providerSubject)
        .first<UserRow>();

      const now = new Date().toISOString();
      const sessionId = `sess_${generateRandomString(32).toLowerCase().replace(/[^a-z0-9]/g, '')}`;
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      if (!existingUser) {
        // New accounts get a random username (user_ + 6 random chars), never derived from email
        const userId = `usr_${generateRandomString(16).toLowerCase().replace(/[^a-z0-9]/g, '')}`;

        let finalUsername = generateRandomUsername();
        while (true) {
          const existing = await env.DB.prepare(
            'SELECT user_id FROM profiles WHERE username_normalized = ?'
          )
            .bind(normalizeUsername(finalUsername))
            .first();
          if (!existing) break;
          finalUsername = generateRandomUsername();
        }

        const normalizedUsername = normalizeUsername(finalUsername);
        const displayName = finalUsername;

        // Use D1 batch for signup: users, profiles, user_settings, session
        try {
          await env.DB.batch([
            env.DB.prepare(
              'INSERT INTO users (id, provider_subject, created_at, status) VALUES (?, ?, ?, ?)'
            ).bind(userId, providerSubject, now, 'active'),
            env.DB.prepare(
              'INSERT INTO profiles (user_id, username, username_normalized, display_name, bio, avatar_media_id) VALUES (?, ?, ?, ?, ?, ?)'
            ).bind(userId, finalUsername, normalizedUsername, displayName, '', null),
            env.DB.prepare(
              'INSERT INTO user_settings (user_id, dm_policy, feed_preferences) VALUES (?, ?, ?)'
            ).bind(userId, 'everyone', '{}'),
            env.DB.prepare(
              'INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)'
            ).bind(sessionId, userId, expiresAt),
          ]);
        } catch (dbErr) {
          const errMsg = (dbErr as Error).message || '';
          if (errMsg.includes('UNIQUE constraint') && errMsg.includes('username')) {
            return jsonResponse({ error: 'Username is already taken' }, 409);
          }
          return jsonResponse({ error: 'Failed to create user account' }, 500);
        }
      } else {
        if (existingUser.status !== 'active') {
          return jsonResponse({ error: 'User account is inactive' }, 403);
        }

        // Insert new session for existing user
        await env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)')
          .bind(sessionId, existingUser.id, expiresAt)
          .run();
      }

      // Return redirect to frontend with session cookie and clear oauth_state
      const headers = new Headers();
      // DEV-ONLY: remove before launch
      // Use relative Location header ("/") in development so the redirect stays on the request's host
      const postLoginLocation = isDevelopment ? '/' : `${env.APP_URL}/`;
      headers.set('Location', postLoginLocation);
      headers.append(
        'Set-Cookie',
        serializeCookie('session_id', sessionId, {
          path: '/',
          maxAge: 30 * 24 * 60 * 60,
          httpOnly: true,
          secure: cookieSecure,
          sameSite: cookieSameSite,
          partitioned: cookiePartitioned,
        })
      );
      headers.append(
        'Set-Cookie',
        serializeCookie('oauth_state', '', {
          path: '/',
          maxAge: 0,
          httpOnly: true,
          secure: cookieSecure,
          sameSite: cookieSameSite,
          partitioned: cookiePartitioned,
        })
      );

      return new Response(null, {
        status: 302,
        headers,
      });
    }

    // 3. POST /api/auth/logout - Invalidate session and clear session cookie
    if (pathname === '/api/auth/logout' && method === 'POST') {
      const cookies = parseCookies(request.headers.get('Cookie'));
      const sessionId = cookies['session_id'];

      if (sessionId) {
        await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
      }

      return jsonResponse(
        { success: true, message: 'Logged out successfully' },
        200,
        {
          'Set-Cookie': serializeCookie('session_id', '', {
            path: '/',
            maxAge: 0,
            httpOnly: true,
            secure: cookieSecure,
            sameSite: cookieSameSite,
            partitioned: cookiePartitioned,
          }),
        }
      );
    }

    // 4. GET /api/users/:username - Public profile by username (REQUIRES A VALID SESSION)
    if (pathname.startsWith('/api/users/') && method === 'GET') {
      const auth = await authenticateRequest(request, env.DB);
      if (!auth) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      const usernameParam = pathname.slice('/api/users/'.length);
      if (!usernameParam) {
        return jsonResponse({ error: 'Username required' }, 400);
      }

      const normalized = normalizeUsername(usernameParam);

      const row = await env.DB.prepare(
        `SELECT p.username, p.display_name, p.bio, p.avatar_media_id, u.created_at
         FROM profiles p
         JOIN users u ON u.id = p.user_id
         WHERE p.username_normalized = ? AND u.status = 'active'`
      )
        .bind(normalized)
        .first<{
          username: string;
          display_name: string;
          bio: string;
          avatar_media_id: string | null;
          created_at: string;
        }>();

      if (!row) {
        return jsonResponse({ error: 'User not found' }, 404);
      }

      // Return public fields only
      return jsonResponse({
        username: row.username,
        display_name: row.display_name,
        bio: row.bio,
        avatar_media_id: row.avatar_media_id,
        created_at: row.created_at,
      });
    }

    // 5. GET /api/me - Retrieve current authenticated user profile
    if (pathname === '/api/me' && method === 'GET') {
      const auth = await authenticateRequest(request, env.DB);
      if (!auth) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      return jsonResponse({
        user: {
          id: auth.user.id,
          created_at: auth.user.created_at,
          status: auth.user.status,
        },
        profile: {
          username: auth.profile.username,
          username_normalized: auth.profile.username_normalized,
          display_name: auth.profile.display_name,
          bio: auth.profile.bio,
          avatar_media_id: auth.profile.avatar_media_id,
        },
        settings: {
          dm_policy: auth.settings.dm_policy,
          feed_preferences: auth.settings.feed_preferences,
        },
      });
    }

    // 6. PATCH /api/me - Update profile fields (validated with shared schema, using D1 batch)
    if (pathname === '/api/me' && method === 'PATCH') {
      const auth = await authenticateRequest(request, env.DB);
      if (!auth) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ error: 'Invalid JSON body' }, 400);
      }

      const parseResult = updateProfileSchema.safeParse(body);
      if (!parseResult.success) {
        return jsonResponse(
          {
            error: 'Validation failed',
            issues: parseResult.error.issues,
          },
          400
        );
      }

      const data = parseResult.data;

      // Check username uniqueness if updating username
      if (data.username !== undefined) {
        const normalized = normalizeUsername(data.username);
        const conflict = await env.DB.prepare(
          'SELECT user_id FROM profiles WHERE username_normalized = ? AND user_id != ?'
        )
          .bind(normalized, auth.user.id)
          .first();

        if (conflict) {
          return jsonResponse({ error: 'Username is already taken' }, 409);
        }
      }

      // Build batch statements for multi-field updates
      const batchStatements: D1PreparedStatement[] = [];

      // Update profiles fields
      if (
        data.username !== undefined ||
        data.display_name !== undefined ||
        data.bio !== undefined ||
        data.avatar_media_id !== undefined
      ) {
        const currentProfile = auth.profile;
        const newUsername = data.username !== undefined ? data.username : currentProfile.username;
        const newNorm = normalizeUsername(newUsername);
        const newDisplayName =
          data.display_name !== undefined ? data.display_name : currentProfile.display_name;
        const newBio = data.bio !== undefined ? data.bio : currentProfile.bio;
        const newAvatar =
          data.avatar_media_id !== undefined ? data.avatar_media_id : currentProfile.avatar_media_id;

        batchStatements.push(
          env.DB.prepare(
            `UPDATE profiles
             SET username = ?, username_normalized = ?, display_name = ?, bio = ?, avatar_media_id = ?
             WHERE user_id = ?`
          ).bind(newUsername, newNorm, newDisplayName, newBio, newAvatar, auth.user.id)
        );
      }

      // Update user_settings fields
      if (data.dm_policy !== undefined || data.feed_preferences !== undefined) {
        const currentSettings = auth.settings;
        const newDmPolicy =
          data.dm_policy !== undefined ? data.dm_policy : currentSettings.dm_policy;
        const newFeedPrefs =
          data.feed_preferences !== undefined
            ? typeof data.feed_preferences === 'string'
              ? data.feed_preferences
              : JSON.stringify(data.feed_preferences)
            : currentSettings.feed_preferences;

        batchStatements.push(
          env.DB.prepare(
            `UPDATE user_settings
             SET dm_policy = ?, feed_preferences = ?
             WHERE user_id = ?`
          ).bind(newDmPolicy, newFeedPrefs, auth.user.id)
        );
      }

      // Execute multi-field update using D1 batch
      if (batchStatements.length > 0) {
        try {
          await env.DB.batch(batchStatements);
        } catch (dbErr) {
          const errMsg = (dbErr as Error).message || '';
          if (errMsg.includes('UNIQUE constraint') && errMsg.includes('username')) {
            return jsonResponse({ error: 'Username is already taken' }, 409);
          }
          return jsonResponse({ error: 'Failed to update profile' }, 500);
        }
      }

      // Return updated profile
      const updatedProfile = await env.DB.prepare('SELECT * FROM profiles WHERE user_id = ?')
        .bind(auth.user.id)
        .first<ProfileRow>();

      const updatedSettings = await env.DB.prepare('SELECT * FROM user_settings WHERE user_id = ?')
        .bind(auth.user.id)
        .first<UserSettingsRow>();

      return jsonResponse({
        user: {
          id: auth.user.id,
          created_at: auth.user.created_at,
          status: auth.user.status,
        },
        profile: updatedProfile,
        settings: updatedSettings,
      });
    }

    // 7. DELETE /api/me - Account deletion: remove user and their rows using D1 batch
    if (pathname === '/api/me' && method === 'DELETE') {
      const auth = await authenticateRequest(request, env.DB);
      if (!auth) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      const userId = auth.user.id;

      // Use D1 batch for atomic account deletion across all tables
      await env.DB.batch([
        env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
        env.DB.prepare('DELETE FROM user_settings WHERE user_id = ?').bind(userId),
        env.DB.prepare('DELETE FROM profiles WHERE user_id = ?').bind(userId),
        env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId),
      ]);

      // Clear session cookie
      return jsonResponse(
        { success: true, message: 'Account and associated data deleted permanently' },
        200,
        {
          'Set-Cookie': serializeCookie('session_id', '', {
            path: '/',
            maxAge: 0,
            httpOnly: true,
            secure: cookieSecure,
            sameSite: cookieSameSite,
            partitioned: cookiePartitioned,
          }),
        }
      );
    }

    // Explicitly reject any starter routes that were deleted or not allowed
    if (pathname === '/api/users' || pathname.startsWith('/api/files')) {
      return jsonResponse({ error: 'Not found' }, 404);
    }

    // Return 404 for any other unrecognized /api/* route
    if (pathname.startsWith('/api/')) {
      return jsonResponse({ error: 'Endpoint not found' }, 404);
    }

    return new Response('Not Found', { status: 404 });
  },
};
