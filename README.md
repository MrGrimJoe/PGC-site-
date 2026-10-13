# DialtoneApp (Cloudflare-Starter) - Milestone 1 Foundation

Milestone 1 foundation for Dialtone, built with React, strict TypeScript, Vite, Cloudflare Workers, Cloudflare D1 (SQLite), and Cloudflare R2.

---

## Architecture & Layout

- **`src/`**: React 19 single-page application (Sign-In, Profile Edit, Public Profile View).
- **`worker/`**: Cloudflare Worker REST API handling authentication, D1 queries, and session management.
- **`migrations/`**: Cloudflare D1 SQL schema migrations (`001_init.sql`).
- **`shared/`**: Shared validation schemas (Zod) and username normalization utilities used across client and server.
- **`tests/`**: Automated test suite (Vitest) validating authentication, PKCE, schemas, permissions, and database migrations.

---

## Database Schema (`migrations/001_init.sql`)

- **`users`**: `id` (opaque primary key), `provider_subject` (unique OAuth subject), `created_at` (UTC ISO string), `status`.
- **`profiles`**: `user_id` (PK / FK -> users.id CASCADE), `username`, `username_normalized` (UNIQUE), `display_name`, `bio`, `avatar_media_id`.
- **`user_settings`**: `user_id` (PK / FK -> users.id CASCADE), `dm_policy`, `feed_preferences`.
- **`sessions`**: `id` (opaque token), `user_id` (FK -> users.id CASCADE), `expires_at` (UTC ISO string).
- Foreign keys and indexes enabled on `provider_subject`, `username_normalized`, `user_id`, and `expires_at`.

---

## Security Model

1. **Google OAuth 2.0 with PKCE, State & Nonce**:
   - Authorization Code flow using `code_challenge` (SHA-256 / `S256`).
   - Ephemeral `oauth_state` cookie stores `state`, `code_verifier`, and `nonce`.
   - ID Token verification validates issuer, audience (`GOOGLE_CLIENT_ID`), expiration, and `nonce`.
2. **HttpOnly Cookies**:
   - Session identifiers are stored exclusively in `HttpOnly; Secure; SameSite=Lax; Path=/` cookies.
   - Zero tokens are stored in `localStorage` or `sessionStorage`.
3. **Strict SQL Injection Prevention**:
   - 100% parameterized SQL prepared statements (`env.DB.prepare(...).bind(...)`).
4. **Access Control**:
   - Profile mutations (`PATCH /api/me`) and account deletions (`DELETE /api/me`) are strictly bound to the authenticated session's user ID. A user can never edit or delete another user's profile.

---

## Setup & Local Development

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Populate:
- `APP_URL`: Base application URL (`http://localhost:3000` for local dev).
- `GOOGLE_CLIENT_ID`: Google OAuth 2.0 Web Client ID.
- `GOOGLE_CLIENT_SECRET`: Google OAuth 2.0 Client Secret.
- Ensure `http://localhost:3000/api/auth/callback` is added as an Authorized Redirect URI in the Google Cloud Console.

### 3. Run Development Server
```bash
npm run dev
```
Starts the fullstack server on `http://localhost:3000` with the Cloudflare Worker API mounted at `/api/*` and Vite dev server.

### 4. Run Automated Tests
```bash
npm test
```
Executes Vitest tests verifying:
- Username normalization and validation
- Zod schema validation
- Auth callback rejection on bad OAuth state
- 401 Unauthorized rejection on `PATCH /api/me` without session
- Strict isolation preventing a user from editing another user's profile
- Migrations execution from an empty database

### 5. Strict Type-Checking
```bash
npm run type-check
```

---

## Cloudflare Deployment

### 1. Provision D1 and R2
```bash
npx wrangler d1 create dialtone-db
npx wrangler r2 bucket create dialtone-media
```
Update `database_id` in `wrangler.toml`.

### 2. Apply Migrations to Remote D1
```bash
npx wrangler d1 migrations apply dialtone-db --remote
```

### 3. Set Cloudflare Worker Secrets
```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

### 4. Deploy
```bash
npm run build
npx wrangler deploy
```

---

## API Routes Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/auth/google` | Initiates Google OAuth with PKCE, state & nonce |
| `GET` | `/api/auth/callback` | Exchanges code, verifies ID token, sets session cookie |
| `POST` | `/api/auth/logout` | Deletes session and clears cookie |
| `GET` | `/api/users/:username` | Returns public profile fields only |
| `GET` | `/api/me` | Returns current authenticated user profile & settings |
| `PATCH` | `/api/me` | Updates current user's profile and settings |
| `DELETE` | `/api/me` | Permanently deletes user and associated rows |
