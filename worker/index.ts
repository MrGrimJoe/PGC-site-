import type { ExecutionContext } from '@cloudflare/workers-types';
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
import { normalizeUsername, isValidUsername } from '../shared/username.ts';
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

export default {
  async fetch(request: Request, env: Env, _ctx?: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method.toUpperCase();

    // CORS / preflight if needed
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

      const isDevMock = url.searchParams.get('mock') === 'true' || env.GOOGLE_CLIENT_ID === 'PLACEHOLDER';
      const targetUrl = isDevMock
        ? `${env.APP_URL || url.origin}/api/auth/callback?code=mock_code&state=${encodeURIComponent(state)}&mock=true`
        : googleAuthUrl.toString();

      return new Response(null, {
        status: 302,
        headers: {
          Location: targetUrl,
          'Set-Cookie': serializeCookie('oauth_state', oauthState, {
            path: '/api/auth/callback',
            maxAge: 600, // 10 minutes
            httpOnly: true,
            secure: true,
            sameSite: 'Lax',
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
        return jsonResponse({ error: `OAuth provider error: ${errorParam}` }, 400);
      }

      const cookies = parseCookies(request.headers.get('Cookie'));
      const rawOAuthCookie = cookies['oauth_state'];

      if (!rawOAuthCookie) {
        return jsonResponse({ error: 'Missing OAuth state cookie' }, 400);
      }

      const oauthState = decodeOAuthState(rawOAuthCookie);
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
      let email = '';
      let displayName = '';

      // Check if this is a test/mock flow or real Google OAuth exchange
      const isMock = url.searchParams.get('mock') === 'true' || code.startsWith('mock_');
      if (isMock) {
        providerSubject = `google_mock_sub_${oauthState.nonce.slice(0, 10)}`;
        email = `testuser_${oauthState.nonce.slice(0, 6)}@example.com`;
        displayName = 'Test User';
      } else {
        // Exchange authorization code with PKCE verifier at Google token endpoint
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
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

        if (!tokenResponse.ok) {
          const errText = await tokenResponse.text();
          return jsonResponse({ error: 'Failed to exchange token with Google', details: errText }, 400);
        }

        const tokenData = (await tokenResponse.json()) as { id_token?: string; access_token?: string };
        if (!tokenData.id_token) {
          return jsonResponse({ error: 'No ID token received from Google' }, 400);
        }

        // Verify ID token claims and nonce
        try {
          const idTokenPayload = await verifyGoogleIdToken(
            tokenData.id_token,
            env.GOOGLE_CLIENT_ID,
            oauthState.nonce
          );
          providerSubject = idTokenPayload.sub;
          email = idTokenPayload.email || '';
          displayName = idTokenPayload.name || 'User';
        } catch (tokenErr) {
          return jsonResponse(
            { error: 'ID token verification failed', details: (tokenErr as Error).message },
            400
          );
        }
      }

      // Check if user already exists
      let user = await env.DB.prepare('SELECT * FROM users WHERE provider_subject = ?')
        .bind(providerSubject)
        .first<UserRow>();

      const now = new Date().toISOString();

      if (!user) {
        // Generate opaque user ID
        const userId = `usr_${generateRandomString(16).toLowerCase().replace(/[^a-z0-9]/g, '')}`;

        // Create a unique base username from email or random string
        const baseFromEmail = email ? email.split('@')[0]?.toLowerCase().replace(/[^a-z0-9_]/g, '_') : '';
        let baseUsername = baseFromEmail && isValidUsername(baseFromEmail) ? baseFromEmail : `user_${userId.slice(4, 10)}`;
        if (baseUsername.length > 20) {
          baseUsername = baseUsername.slice(0, 20);
        }

        // Check username collision
        let finalUsername = baseUsername;
        let counter = 1;
        while (true) {
          const existing = await env.DB.prepare('SELECT user_id FROM profiles WHERE username_normalized = ?')
            .bind(normalizeUsername(finalUsername))
            .first();
          if (!existing) break;
          const suffix = `_${counter++}`;
          finalUsername = `${baseUsername.slice(0, Math.max(3, 20 - suffix.length))}${suffix}`;
        }

        const normalizedUsername = normalizeUsername(finalUsername);

        // Parameterized inserts
        await env.DB.prepare(
          'INSERT INTO users (id, provider_subject, created_at, status) VALUES (?, ?, ?, ?)'
        )
          .bind(userId, providerSubject, now, 'active')
          .run();

        await env.DB.prepare(
          'INSERT INTO profiles (user_id, username, username_normalized, display_name, bio, avatar_media_id) VALUES (?, ?, ?, ?, ?, ?)'
        )
          .bind(userId, finalUsername, normalizedUsername, displayName || finalUsername, '', null)
          .run();

        await env.DB.prepare(
          'INSERT INTO user_settings (user_id, dm_policy, feed_preferences) VALUES (?, ?, ?)'
        )
          .bind(userId, 'everyone', '{}')
          .run();

        user = {
          id: userId,
          provider_subject: providerSubject,
          created_at: now,
          status: 'active',
        };
      } else {
        if (user.status !== 'active') {
          return jsonResponse({ error: 'User account is inactive' }, 403);
        }
      }

      // Create new session: 30 days expiry
      const sessionId = `sess_${generateRandomString(32).toLowerCase().replace(/[^a-z0-9]/g, '')}`;
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      await env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)')
        .bind(sessionId, user.id, expiresAt)
        .run();

      // Return redirect to frontend with session cookie and clear oauth_state
      const headers = new Headers();
      headers.set('Location', `${env.APP_URL || url.origin}/`);
      headers.append(
        'Set-Cookie',
        serializeCookie('session_id', sessionId, {
          path: '/',
          maxAge: 30 * 24 * 60 * 60,
          httpOnly: true,
          secure: true,
          sameSite: 'Lax',
        })
      );
      headers.append(
        'Set-Cookie',
        serializeCookie('oauth_state', '', {
          path: '/api/auth/callback',
          maxAge: 0,
          httpOnly: true,
          secure: true,
          sameSite: 'Lax',
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
            secure: true,
            sameSite: 'Lax',
          }),
        }
      );
    }

    // 4. GET /api/users/:username - Public profile by username
    if (pathname.startsWith('/api/users/') && method === 'GET') {
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

    // 6. PATCH /api/me - Update profile fields (validated with shared schema)
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

        await env.DB.prepare(
          'UPDATE profiles SET username = ?, username_normalized = ? WHERE user_id = ?'
        )
          .bind(data.username, normalized, auth.user.id)
          .run();
      }

      // Update remaining profile fields
      if (data.display_name !== undefined) {
        await env.DB.prepare('UPDATE profiles SET display_name = ? WHERE user_id = ?')
          .bind(data.display_name, auth.user.id)
          .run();
      }

      if (data.bio !== undefined) {
        await env.DB.prepare('UPDATE profiles SET bio = ? WHERE user_id = ?')
          .bind(data.bio, auth.user.id)
          .run();
      }

      if (data.avatar_media_id !== undefined) {
        await env.DB.prepare('UPDATE profiles SET avatar_media_id = ? WHERE user_id = ?')
          .bind(data.avatar_media_id, auth.user.id)
          .run();
      }

      // Update user settings
      if (data.dm_policy !== undefined) {
        await env.DB.prepare('UPDATE user_settings SET dm_policy = ? WHERE user_id = ?')
          .bind(data.dm_policy, auth.user.id)
          .run();
      }

      if (data.feed_preferences !== undefined) {
        const prefStr =
          typeof data.feed_preferences === 'string'
            ? data.feed_preferences
            : JSON.stringify(data.feed_preferences);
        await env.DB.prepare('UPDATE user_settings SET feed_preferences = ? WHERE user_id = ?')
          .bind(prefStr, auth.user.id)
          .run();
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

    // 7. DELETE /api/me - Account deletion: remove user and their rows
    if (pathname === '/api/me' && method === 'DELETE') {
      const auth = await authenticateRequest(request, env.DB);
      if (!auth) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      const userId = auth.user.id;

      // Delete user's rows across tables with parameterized queries
      await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
      await env.DB.prepare('DELETE FROM user_settings WHERE user_id = ?').bind(userId).run();
      await env.DB.prepare('DELETE FROM profiles WHERE user_id = ?').bind(userId).run();
      await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();

      // Clear session cookie
      return jsonResponse(
        { success: true, message: 'Account and associated data deleted permanently' },
        200,
        {
          'Set-Cookie': serializeCookie('session_id', '', {
            path: '/',
            maxAge: 0,
            httpOnly: true,
            secure: true,
            sameSite: 'Lax',
          }),
        }
      );
    }

    // Explicitly reject any starter routes that were deleted or not allowed
    // E.g. /api/users (list), /api/files
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
