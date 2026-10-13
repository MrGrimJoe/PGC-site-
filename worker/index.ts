import type { ExecutionContext, D1PreparedStatement, ScheduledController } from '@cloudflare/workers-types';
import type { Env, ProfileRow, UserRow, UserSettingsRow, PostRow, MediaRow } from './types.ts';
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
import {
  updateProfileSchema,
  createPostSchema,
  createCommentSchema,
  createReportSchema,
  type PostItem,
  type CommentItem,
  type MediaItem,
} from '../shared/schema.ts';
import { checkRateLimit } from './rate-limit.ts';
import { runPostLifecycleExpiry, deletePostAndMedia } from './jobs/expiry.ts';

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
  // Cloudflare Scheduled Cron Trigger handler for daily post expiry job
  async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    await runPostLifecycleExpiry(env);
  },

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

    // CLEANUP #1: Revert oauth_state cookie to Path=/api/auth/callback outside development
    const oauthCookiePath = isDevelopment ? '/' : '/api/auth/callback';

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

    // ==========================================
    // 1. AUTHENTICATION ROUTES
    // ==========================================

    // GET /api/auth/google - Initiate Google Sign-In with PKCE
    if (pathname === '/api/auth/google' && method === 'GET') {
      // DEV-ONLY: remove before launch
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
      const targetUrl =
        isMockRequested && isDevelopment
          ? `/api/auth/callback?code=mock_code&state=${encodeURIComponent(state)}&mock=true`
          : googleAuthUrl.toString();

      return new Response(null, {
        status: 302,
        headers: {
          Location: targetUrl,
          'Set-Cookie': serializeCookie('oauth_state', oauthState, {
            path: oauthCookiePath,
            maxAge: 600,
            httpOnly: true,
            secure: cookieSecure,
            sameSite: cookieSameSite,
            partitioned: cookiePartitioned,
          }),
        },
      });
    }

    // GET /api/auth/callback - Handle OAuth callback
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
        // Usernames for new accounts are random (user_ + 6 random chars), never derived from email
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

        // D1 batch for signup: users, profiles, user_settings, sessions
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

        await env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)')
          .bind(sessionId, existingUser.id, expiresAt)
          .run();
      }

      const headers = new Headers();
      // DEV-ONLY: remove before launch
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
          path: oauthCookiePath,
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

    // POST /api/auth/logout - Invalidate session
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

    // ==========================================
    // 2. USER PROFILE & SETTINGS ROUTES
    // ==========================================

    // GET /api/users/:username - Public profile by username (requires session)
    if (pathname.startsWith('/api/users/') && !pathname.includes('/follow') && method === 'GET') {
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
        `SELECT p.user_id, p.username, p.display_name, p.bio, p.avatar_media_id, u.created_at
         FROM profiles p
         JOIN users u ON u.id = p.user_id
         WHERE p.username_normalized = ? AND u.status = 'active'`
      )
        .bind(normalized)
        .first<{
          user_id: string;
          username: string;
          display_name: string;
          bio: string;
          avatar_media_id: string | null;
          created_at: string;
        }>();

      if (!row) {
        return jsonResponse({ error: 'User not found' }, 404);
      }

      // Check if current user follows this user
      const isFollowing = await env.DB.prepare(
        'SELECT 1 FROM follows WHERE follower_id = ? AND followed_id = ?'
      )
        .bind(auth.user.id, row.user_id)
        .first();

      const followersCount = await env.DB.prepare(
        'SELECT COUNT(*) as count FROM follows WHERE followed_id = ?'
      )
        .bind(row.user_id)
        .first<{ count: number }>();

      const followingCount = await env.DB.prepare(
        'SELECT COUNT(*) as count FROM follows WHERE follower_id = ?'
      )
        .bind(row.user_id)
        .first<{ count: number }>();

      return jsonResponse({
        username: row.username,
        display_name: row.display_name,
        bio: row.bio,
        avatar_media_id: row.avatar_media_id,
        created_at: row.created_at,
        is_following: !!isFollowing,
        followers_count: Number(followersCount?.count || 0),
        following_count: Number(followingCount?.count || 0),
      });
    }

    // GET /api/me - Retrieve current authenticated profile
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

    // PATCH /api/me - Update profile fields (validated with shared schema, using D1 batch)
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

      const batchStatements: D1PreparedStatement[] = [];

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

    // DELETE /api/me - Account deletion in D1 batch
    if (pathname === '/api/me' && method === 'DELETE') {
      const auth = await authenticateRequest(request, env.DB);
      if (!auth) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      const userId = auth.user.id;

      // Find all media owned by user to clean up from R2
      const userMedia = await env.DB.prepare('SELECT object_key FROM media WHERE owner_id = ?')
        .bind(userId)
        .all<{ object_key: string }>();

      if (env.MEDIA_BUCKET && userMedia.results) {
        for (const m of userMedia.results) {
          try {
            await env.MEDIA_BUCKET.delete(m.object_key);
          } catch {
            // Ignore R2 deletion error during account purge
          }
        }
      }

      await env.DB.batch([
        env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
        env.DB.prepare('DELETE FROM user_settings WHERE user_id = ?').bind(userId),
        env.DB.prepare('DELETE FROM profiles WHERE user_id = ?').bind(userId),
        env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId),
      ]);

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

    // ==========================================
    // 3. SOCIAL POSTS, FEED & INTERACTIONS
    // ==========================================

    // POST /api/posts - Create new post (body max 1000 chars, up to 4 images, 7-day expiry)
    if (pathname === '/api/posts' && method === 'POST') {
      const auth = await authenticateRequest(request, env.DB);
      if (!auth) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      // Rate limit: max 10 posts per hour per user
      const rate = checkRateLimit(`post:${auth.user.id}`, 10, 60 * 60 * 1000);
      if (!rate.allowed) {
        return jsonResponse(
          { error: 'Rate limit exceeded: maximum 10 posts per hour. Please try again later.' },
          429,
          { 'Retry-After': String(rate.retryAfterSeconds) }
        );
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ error: 'Invalid JSON body' }, 400);
      }

      const parseResult = createPostSchema.safeParse(body);
      if (!parseResult.success) {
        return jsonResponse(
          { error: 'Validation failed', issues: parseResult.error.issues },
          400
        );
      }

      const { body: postBody, media_ids = [] } = parseResult.data;

      // Validate media_ids: max 4, owned by author, exist
      if (media_ids.length > 0) {
        for (const mId of media_ids) {
          const mediaRow = await env.DB.prepare(
            'SELECT id, owner_id FROM media WHERE id = ?'
          )
            .bind(mId)
            .first<{ id: string; owner_id: string }>();

          if (!mediaRow) {
            return jsonResponse({ error: `Media ${mId} not found` }, 400);
          }
          if (mediaRow.owner_id !== auth.user.id) {
            return jsonResponse({ error: `You do not own media ${mId}` }, 403);
          }
        }
      }

      const nowMs = Date.now();
      const createdAt = new Date(nowMs).toISOString();
      // New posts get expires_at = created_at + 7 days
      const expiresAt = new Date(nowMs + 7 * 24 * 60 * 60 * 1000).toISOString();
      const postId = `pst_${generateRandomString(16).toLowerCase().replace(/[^a-z0-9]/g, '')}`;

      const statements: D1PreparedStatement[] = [
        env.DB.prepare(
          'INSERT INTO posts (id, author_id, body, created_at, expires_at, status) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(postId, auth.user.id, postBody, createdAt, expiresAt, 'active'),
      ];

      for (const mId of media_ids) {
        statements.push(
          env.DB.prepare(
            'INSERT INTO post_media (post_id, media_id) VALUES (?, ?)'
          ).bind(postId, mId)
        );
      }

      await env.DB.batch(statements);

      return jsonResponse(
        {
          id: postId,
          author_id: auth.user.id,
          body: postBody,
          created_at: createdAt,
          expires_at: expiresAt,
          status: 'active',
          media_ids,
        },
        201
      );
    }

    // GET /api/posts/:id - Retrieve single post with media, likes count, and user like status
    if (pathname.startsWith('/api/posts/') && !pathname.includes('/likes') && !pathname.includes('/comments') && method === 'GET') {
      const auth = await authenticateRequest(request, env.DB);
      if (!auth) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      const postId = pathname.slice('/api/posts/'.length);
      const post = await env.DB.prepare(
        `SELECT p.id, p.author_id, p.body, p.created_at, p.expires_at, p.status,
                pr.username AS author_username, pr.display_name AS author_display_name, pr.avatar_media_id AS author_avatar_media_id
         FROM posts p
         JOIN profiles pr ON pr.user_id = p.author_id
         WHERE p.id = ? AND p.status = 'active'`
      )
        .bind(postId)
        .first<PostRow & { author_username: string; author_display_name: string; author_avatar_media_id: string | null }>();

      if (!post) {
        return jsonResponse({ error: 'Post not found' }, 404);
      }

      // Fetch linked media
      const media = await env.DB.prepare(
        `SELECT m.id, m.object_key, m.mime_type, m.size_bytes
         FROM media m
         JOIN post_media pm ON pm.media_id = m.id
         WHERE pm.post_id = ?`
      )
        .bind(postId)
        .all<MediaItem>();

      // Likes count and user like status
      const likesCount = await env.DB.prepare(
        'SELECT COUNT(*) as count FROM post_reactions WHERE post_id = ?'
      )
        .bind(postId)
        .first<{ count: number }>();

      const hasLiked = await env.DB.prepare(
        'SELECT 1 FROM post_reactions WHERE post_id = ? AND user_id = ?'
      )
        .bind(postId, auth.user.id)
        .first();

      const commentsCount = await env.DB.prepare(
        'SELECT COUNT(*) as count FROM comments WHERE post_id = ?'
      )
        .bind(postId)
        .first<{ count: number }>();

      const postItem: PostItem = {
        id: post.id,
        author_id: post.author_id,
        author_username: post.author_username,
        author_display_name: post.author_display_name,
        author_avatar_media_id: post.author_avatar_media_id,
        body: post.body,
        created_at: post.created_at,
        expires_at: post.expires_at,
        status: post.status,
        media: media.results || [],
        likes_count: Number(likesCount?.count || 0),
        has_liked: !!hasLiked,
        comments_count: Number(commentsCount?.count || 0),
      };

      return jsonResponse(postItem);
    }

    // DELETE /api/posts/:id - Author only delete
    if (pathname.startsWith('/api/posts/') && !pathname.includes('/likes') && !pathname.includes('/comments') && method === 'DELETE') {
      const auth = await authenticateRequest(request, env.DB);
      if (!auth) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      const postId = pathname.slice('/api/posts/'.length);
      const post = await env.DB.prepare('SELECT author_id FROM posts WHERE id = ?')
        .bind(postId)
        .first<{ author_id: string }>();

      if (!post) {
        return jsonResponse({ error: 'Post not found' }, 404);
      }

      // Check author ownership
      if (post.author_id !== auth.user.id) {
        return jsonResponse({ error: 'Forbidden: You can only delete your own posts' }, 403);
      }

      await deletePostAndMedia(env, postId);

      return jsonResponse({ success: true, message: 'Post deleted successfully' });
    }

    // GET /api/feed - Chronological feed from followed users plus own posts with cursor pagination
    if (pathname === '/api/feed' && method === 'GET') {
      const auth = await authenticateRequest(request, env.DB);
      if (!auth) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      const cursor = url.searchParams.get('cursor'); // ISO date string of last post's created_at
      const limit = Math.min(Math.max(1, Number(url.searchParams.get('limit') || 20)), 50);

      let query = `
        SELECT p.id, p.author_id, p.body, p.created_at, p.expires_at, p.status,
               pr.username AS author_username, pr.display_name AS author_display_name, pr.avatar_media_id AS author_avatar_media_id
        FROM posts p
        JOIN profiles pr ON pr.user_id = p.author_id
        WHERE p.status = 'active'
          AND p.expires_at > datetime('now')
          AND (p.author_id = ? OR p.author_id IN (SELECT followed_id FROM follows WHERE follower_id = ?))
      `;

      const params: unknown[] = [auth.user.id, auth.user.id];

      if (cursor) {
        query += ' AND p.created_at < ?';
        params.push(cursor);
      }

      query += ' ORDER BY p.created_at DESC LIMIT ?';
      params.push(limit + 1);

      const rowsResult = await env.DB.prepare(query)
        .bind(...params)
        .all<PostRow & { author_username: string; author_display_name: string; author_avatar_media_id: string | null }>();

      const rows = rowsResult.results || [];
      const hasMore = rows.length > limit;
      const itemsToReturn = hasMore ? rows.slice(0, limit) : rows;

      // Populate media, likes, and comments for returned items
      const posts: PostItem[] = [];
      for (const p of itemsToReturn) {
        const media = await env.DB.prepare(
          `SELECT m.id, m.object_key, m.mime_type, m.size_bytes
           FROM media m
           JOIN post_media pm ON pm.media_id = m.id
           WHERE pm.post_id = ?`
        )
          .bind(p.id)
          .all<MediaItem>();

        const likesCount = await env.DB.prepare(
          'SELECT COUNT(*) as count FROM post_reactions WHERE post_id = ?'
        )
          .bind(p.id)
          .first<{ count: number }>();

        const hasLiked = await env.DB.prepare(
          'SELECT 1 FROM post_reactions WHERE post_id = ? AND user_id = ?'
        )
          .bind(p.id, auth.user.id)
          .first();

        const commentsCount = await env.DB.prepare(
          'SELECT COUNT(*) as count FROM comments WHERE post_id = ?'
        )
          .bind(p.id)
          .first<{ count: number }>();

        posts.push({
          id: p.id,
          author_id: p.author_id,
          author_username: p.author_username,
          author_display_name: p.author_display_name,
          author_avatar_media_id: p.author_avatar_media_id,
          body: p.body,
          created_at: p.created_at,
          expires_at: p.expires_at,
          status: p.status,
          media: media.results || [],
          likes_count: Number(likesCount?.count || 0),
          has_liked: !!hasLiked,
          comments_count: Number(commentsCount?.count || 0),
        });
      }

      const nextCursor =
        hasMore && posts.length > 0 ? posts[posts.length - 1]!.created_at : null;

      return jsonResponse({
        posts,
        next_cursor: nextCursor,
        has_more: hasMore,
      });
    }

    // POST /api/posts/:id/likes - Like a post
    if (pathname.match(/^\/api\/posts\/[^/]+\/likes$/) && method === 'POST') {
      const auth = await authenticateRequest(request, env.DB);
      if (!auth) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      const postId = pathname.split('/')[3]!;
      const post = await env.DB.prepare("SELECT id FROM posts WHERE id = ? AND status = 'active'")
        .bind(postId)
        .first();

      if (!post) {
        return jsonResponse({ error: 'Post not found' }, 404);
      }

      const now = new Date().toISOString();
      try {
        await env.DB.prepare(
          'INSERT OR IGNORE INTO post_reactions (post_id, user_id, type, created_at) VALUES (?, ?, ?, ?)'
        )
          .bind(postId, auth.user.id, 'like', now)
          .run();
      } catch {
        // Ignored if reaction already exists
      }

      const likesCount = await env.DB.prepare(
        'SELECT COUNT(*) as count FROM post_reactions WHERE post_id = ?'
      )
        .bind(postId)
        .first<{ count: number }>();

      return jsonResponse({
        success: true,
        has_liked: true,
        likes_count: Number(likesCount?.count || 0),
      });
    }

    // DELETE /api/posts/:id/likes - Unlike a post
    if (pathname.match(/^\/api\/posts\/[^/]+\/likes$/) && method === 'DELETE') {
      const auth = await authenticateRequest(request, env.DB);
      if (!auth) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      const postId = pathname.split('/')[3]!;

      await env.DB.prepare(
        'DELETE FROM post_reactions WHERE post_id = ? AND user_id = ? AND type = "like"'
      )
        .bind(postId, auth.user.id)
        .run();

      const likesCount = await env.DB.prepare(
        'SELECT COUNT(*) as count FROM post_reactions WHERE post_id = ?'
      )
        .bind(postId)
        .first<{ count: number }>();

      return jsonResponse({
        success: true,
        has_liked: false,
        likes_count: Number(likesCount?.count || 0),
      });
    }

    // GET /api/posts/:id/comments - Retrieve comments on a post
    if (pathname.match(/^\/api\/posts\/[^/]+\/comments$/) && method === 'GET') {
      const auth = await authenticateRequest(request, env.DB);
      if (!auth) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      const postId = pathname.split('/')[3]!;
      const cursor = url.searchParams.get('cursor');
      const limit = Math.min(Math.max(1, Number(url.searchParams.get('limit') || 20)), 50);

      let query = `
        SELECT c.id, c.post_id, c.author_id, c.body, c.created_at,
               pr.username AS author_username, pr.display_name AS author_display_name
        FROM comments c
        JOIN profiles pr ON pr.user_id = c.author_id
        WHERE c.post_id = ?
      `;
      const params: unknown[] = [postId];

      if (cursor) {
        query += ' AND c.created_at > ?';
        params.push(cursor);
      }

      query += ' ORDER BY c.created_at ASC LIMIT ?';
      params.push(limit + 1);

      const rowsResult = await env.DB.prepare(query)
        .bind(...params)
        .all<CommentItem>();

      const rows = rowsResult.results || [];
      const hasMore = rows.length > limit;
      const comments = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor =
        hasMore && comments.length > 0 ? comments[comments.length - 1]!.created_at : null;

      return jsonResponse({
        comments,
        next_cursor: nextCursor,
        has_more: hasMore,
      });
    }

    // POST /api/posts/:id/comments - Add comment to post
    if (pathname.match(/^\/api\/posts\/[^/]+\/comments$/) && method === 'POST') {
      const auth = await authenticateRequest(request, env.DB);
      if (!auth) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      // Rate limit: max 30 comments per hour per user
      const rate = checkRateLimit(`comment:${auth.user.id}`, 30, 60 * 60 * 1000);
      if (!rate.allowed) {
        return jsonResponse(
          { error: 'Rate limit exceeded: maximum 30 comments per hour. Please try again later.' },
          429,
          { 'Retry-After': String(rate.retryAfterSeconds) }
        );
      }

      const postId = pathname.split('/')[3]!;
      const post = await env.DB.prepare("SELECT id, expires_at FROM posts WHERE id = ? AND status = 'active'")
        .bind(postId)
        .first<{ id: string; expires_at: string }>();

      if (!post) {
        return jsonResponse({ error: 'Post not found' }, 404);
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ error: 'Invalid JSON body' }, 400);
      }

      const parseResult = createCommentSchema.safeParse(body);
      if (!parseResult.success) {
        return jsonResponse(
          { error: 'Validation failed', issues: parseResult.error.issues },
          400
        );
      }

      const commentId = `cmt_${generateRandomString(16).toLowerCase().replace(/[^a-z0-9]/g, '')}`;
      const now = new Date().toISOString();

      await env.DB.prepare(
        'INSERT INTO comments (id, post_id, author_id, body, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
        .bind(commentId, postId, auth.user.id, parseResult.data.body, now, post.expires_at)
        .run();

      return jsonResponse(
        {
          id: commentId,
          post_id: postId,
          author_id: auth.user.id,
          author_username: auth.profile.username,
          author_display_name: auth.profile.display_name,
          body: parseResult.data.body,
          created_at: now,
        },
        201
      );
    }

    // DELETE /api/comments/:id - Author only delete comment
    if (pathname.startsWith('/api/comments/') && method === 'DELETE') {
      const auth = await authenticateRequest(request, env.DB);
      if (!auth) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      const commentId = pathname.slice('/api/comments/'.length);
      const comment = await env.DB.prepare('SELECT author_id FROM comments WHERE id = ?')
        .bind(commentId)
        .first<{ author_id: string }>();

      if (!comment) {
        return jsonResponse({ error: 'Comment not found' }, 404);
      }

      if (comment.author_id !== auth.user.id) {
        return jsonResponse({ error: 'Forbidden: You can only delete your own comments' }, 403);
      }

      await env.DB.prepare('DELETE FROM comments WHERE id = ?').bind(commentId).run();

      return jsonResponse({ success: true, message: 'Comment deleted successfully' });
    }

    // ==========================================
    // 4. SOCIAL FOLLOWS & REPORTS
    // ==========================================

    // POST /api/users/:id/follow - Follow user
    if (pathname.match(/^\/api\/users\/[^/]+\/follow$/) && method === 'POST') {
      const auth = await authenticateRequest(request, env.DB);
      if (!auth) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      const param = pathname.split('/')[3]!;

      // Find target user by id or username
      const target = await env.DB.prepare(
        'SELECT id FROM users WHERE id = ? OR id IN (SELECT user_id FROM profiles WHERE username_normalized = ?)'
      )
        .bind(param, normalizeUsername(param))
        .first<{ id: string }>();

      if (!target) {
        return jsonResponse({ error: 'User not found' }, 404);
      }

      // Reject self-follow
      if (target.id === auth.user.id) {
        return jsonResponse({ error: 'Cannot follow yourself' }, 400);
      }

      const now = new Date().toISOString();
      await env.DB.prepare(
        'INSERT OR IGNORE INTO follows (follower_id, followed_id, created_at) VALUES (?, ?, ?)'
      )
        .bind(auth.user.id, target.id, now)
        .run();

      return jsonResponse({ success: true, is_following: true });
    }

    // DELETE /api/users/:id/follow - Unfollow user
    if (pathname.match(/^\/api\/users\/[^/]+\/follow$/) && method === 'DELETE') {
      const auth = await authenticateRequest(request, env.DB);
      if (!auth) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      const param = pathname.split('/')[3]!;

      const target = await env.DB.prepare(
        'SELECT id FROM users WHERE id = ? OR id IN (SELECT user_id FROM profiles WHERE username_normalized = ?)'
      )
        .bind(param, normalizeUsername(param))
        .first<{ id: string }>();

      if (target) {
        await env.DB.prepare(
          'DELETE FROM follows WHERE follower_id = ? AND followed_id = ?'
        )
          .bind(auth.user.id, target.id)
          .run();
      }

      return jsonResponse({ success: true, is_following: false });
    }

    // POST /api/reports - File a moderation report
    if (pathname === '/api/reports' && method === 'POST') {
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

      const parseResult = createReportSchema.safeParse(body);
      if (!parseResult.success) {
        return jsonResponse(
          { error: 'Validation failed', issues: parseResult.error.issues },
          400
        );
      }

      const { target_type, target_id, reason } = parseResult.data;
      const reportId = `rep_${generateRandomString(16).toLowerCase().replace(/[^a-z0-9]/g, '')}`;
      const now = new Date().toISOString();

      await env.DB.prepare(
        'INSERT INTO reports (id, reporter_id, target_type, target_id, reason, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
        .bind(reportId, auth.user.id, target_type, target_id, reason, 'pending', now)
        .run();

      return jsonResponse(
        { success: true, message: 'Report submitted successfully', id: reportId },
        201
      );
    }

    // ==========================================
    // 5. MEDIA STORAGE (R2) & AUTHORIZED SERVING
    // ==========================================

    // POST /api/media/uploads - Upload media (max 5 MB, jpeg/png/webp only)
    if (pathname === '/api/media/uploads' && method === 'POST') {
      const auth = await authenticateRequest(request, env.DB);
      if (!auth) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      // Rate limit: max 20 uploads per hour per user
      const rate = checkRateLimit(`upload:${auth.user.id}`, 20, 60 * 60 * 1000);
      if (!rate.allowed) {
        return jsonResponse(
          { error: 'Rate limit exceeded: maximum 20 uploads per hour. Please try again later.' },
          429,
          { 'Retry-After': String(rate.retryAfterSeconds) }
        );
      }

      const contentType = request.headers.get('Content-Type') || '';
      let fileBytes: Uint8Array;
      let mimeType = '';

      if (contentType.includes('multipart/form-data')) {
        let formData: FormData;
        try {
          formData = await request.formData();
        } catch {
          return jsonResponse({ error: 'Invalid form data' }, 400);
        }

        const file = formData.get('file');
        if (!file || typeof file === 'string') {
          return jsonResponse({ error: 'Missing file field in form data' }, 400);
        }

        mimeType = (file as File).type;
        const ab = await (file as File).arrayBuffer();
        fileBytes = new Uint8Array(ab);
      } else {
        // Direct binary upload with Content-Type header
        mimeType = contentType.split(';')[0]!.trim();
        const ab = await request.arrayBuffer();
        fileBytes = new Uint8Array(ab);
      }

      // Validate MIME type (jpeg/png/webp)
      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
      if (!allowedTypes.includes(mimeType)) {
        return jsonResponse(
          { error: `Invalid image type: "${mimeType}". Only JPEG, PNG, and WebP are supported.` },
          400
        );
      }

      // Validate file size (max 5 MB)
      const maxSizeBytes = 5 * 1024 * 1024;
      if (fileBytes.length === 0) {
        return jsonResponse({ error: 'File is empty' }, 400);
      }
      if (fileBytes.length > maxSizeBytes) {
        return jsonResponse(
          { error: `File exceeds maximum size of 5 MB (actual: ${(fileBytes.length / (1024 * 1024)).toFixed(2)} MB)` },
          400
        );
      }

      // Generate random object key
      const mediaId = `med_${generateRandomString(16).toLowerCase().replace(/[^a-z0-9]/g, '')}`;
      const objectKey = `media_${generateRandomString(24).toLowerCase().replace(/[^a-z0-9]/g, '')}`;

      // Store in R2
      if (env.MEDIA_BUCKET) {
        await env.MEDIA_BUCKET.put(objectKey, fileBytes, {
          httpMetadata: { contentType: mimeType },
        });
      }

      const nowMs = Date.now();
      const createdAt = new Date(nowMs).toISOString();
      const expiresAt = new Date(nowMs + 7 * 24 * 60 * 60 * 1000).toISOString();

      await env.DB.prepare(
        'INSERT INTO media (id, owner_id, object_key, mime_type, size_bytes, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
        .bind(mediaId, auth.user.id, objectKey, mimeType, fileBytes.length, createdAt, expiresAt)
        .run();

      return jsonResponse(
        {
          id: mediaId,
          object_key: objectKey,
          mime_type: mimeType,
          size_bytes: fileBytes.length,
          created_at: createdAt,
        },
        201
      );
    }

    // GET /api/media/:id - Authorized Worker route serving R2 stream
    if (pathname.startsWith('/api/media/') && method === 'GET') {
      const auth = await authenticateRequest(request, env.DB);
      if (!auth) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      const mediaId = pathname.slice('/api/media/'.length);
      const media = await env.DB.prepare(
        'SELECT id, object_key, mime_type FROM media WHERE id = ?'
      )
        .bind(mediaId)
        .first<MediaRow>();

      if (!media) {
        return jsonResponse({ error: 'Media not found' }, 404);
      }

      if (!env.MEDIA_BUCKET) {
        return jsonResponse({ error: 'Storage unavailable' }, 503);
      }

      const r2Object = await env.MEDIA_BUCKET.get(media.object_key);
      if (!r2Object) {
        return jsonResponse({ error: 'Media file missing from storage' }, 404);
      }

      return new Response(r2Object.body as any, {
        headers: {
          'Content-Type': media.mime_type,
          'Cache-Control': 'private, max-age=86400',
        },
      });
    }

    // DELETE /api/media/:id - Delete media (owner only)
    if (pathname.startsWith('/api/media/') && method === 'DELETE') {
      const auth = await authenticateRequest(request, env.DB);
      if (!auth) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      const mediaId = pathname.slice('/api/media/'.length);
      const media = await env.DB.prepare(
        'SELECT id, owner_id, object_key FROM media WHERE id = ?'
      )
        .bind(mediaId)
        .first<MediaRow>();

      if (!media) {
        return jsonResponse({ error: 'Media not found' }, 404);
      }

      if (media.owner_id !== auth.user.id) {
        return jsonResponse({ error: 'Forbidden: You can only delete your own media' }, 403);
      }

      if (env.MEDIA_BUCKET) {
        try {
          await env.MEDIA_BUCKET.delete(media.object_key);
        } catch {
          // Ignore R2 deletion error
        }
      }

      await env.DB.prepare('DELETE FROM media WHERE id = ?').bind(mediaId).run();

      return jsonResponse({ success: true, message: 'Media deleted successfully' });
    }

    // ==========================================
    // 6. JOBS & LIFECYCLE
    // ==========================================

    // POST /api/jobs/cleanup-expired - Trigger post lifecycle expiry job
    if (pathname === '/api/jobs/cleanup-expired' && method === 'POST') {
      const auth = await authenticateRequest(request, env.DB);
      if (!auth) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      // Optional reference_time query param for testing time travel
      const refTimeParam = url.searchParams.get('reference_time');
      const refTime = refTimeParam ? Number(refTimeParam) : Date.now();

      const result = await runPostLifecycleExpiry(env, refTime);
      return jsonResponse(result);
    }

    // ==========================================
    // 7. 404 CATCH-ALL
    // ==========================================

    if (pathname.startsWith('/api/')) {
      return jsonResponse({ error: 'Endpoint not found' }, 404);
    }

    return new Response('Not Found', { status: 404 });
  },
};
