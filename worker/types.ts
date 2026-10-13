/**
 * Environment variables and bindings for the Cloudflare Worker.
 */
export interface Env {
  // Cloudflare D1 Database binding
  DB: D1Database;

  // Cloudflare R2 Bucket binding
  MEDIA_BUCKET?: R2Bucket;

  // Google OAuth credentials
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;

  // Canonical base application URL (e.g. http://localhost:3000 or production domain)
  APP_URL: string;

  // Optional session encryption secret
  SESSION_SECRET?: string;

  // Environment mode (e.g., development, production, test)
  ENVIRONMENT?: string;
}

export interface UserRow {
  id: string;
  provider_subject: string;
  created_at: string;
  status: string;
}

export interface ProfileRow {
  user_id: string;
  username: string;
  username_normalized: string;
  display_name: string;
  bio: string;
  avatar_media_id: string | null;
}

export interface UserSettingsRow {
  user_id: string;
  dm_policy: string;
  feed_preferences: string;
}

export interface SessionRow {
  id: string;
  user_id: string;
  expires_at: string;
}

export interface OAuthStatePayload {
  state: string;
  codeVerifier: string;
  nonce: string;
  createdAt: number;
}
