# app/api/ — API Routes

All routes are Next.js App Router Route Handlers. All protected routes call `getAuthUser()` and return 401 if null.

## /api/auth (POST / DELETE)
**POST** — Login. Body: `{ username, password }`. Validates against ADMIN_USERNAME/ADMIN_PASSWORD env vars. On success: signs JWT, sets `creativeiq_token` HttpOnly cookie (7 days), returns `{ success, username }`.

**DELETE** — Logout. Clears the `creativeiq_token` cookie.

## /api/chat (POST)
Body: `{ sessionId?, message, history }` where `history` is `Array<{ role: 'user'|'model', parts: string }>`.

1. Creates a session row in Neon if `sessionId` not provided
2. Calls `sendChatMessage()` with the full history + user message
3. Parses `<BRIEF_JSON>...</BRIEF_JSON>` block from response (if present)
4. Returns: `{ sessionId, response, briefData }` — `briefData` is the parsed brief JSON or null

## /api/generate (POST)
Body: `{ sessionId?, brief: BriefJSON, variantCount: 1–10, logoUrl? }`

For each variant (sequential):
1. Adds variant instruction to brief (variation directives rotate: composition, palette, expression, headline, bg environment)
2. Appends logo context to brand_constraints if logoUrl present
3. Calls `assemblMetaPrompt(brief)` → Gemini Flash
4. Calls `generateImage(metaPrompt)` → gemini-3-pro-image-preview (auto-retries once on failure)
5. Saves image to UPLOAD_DIR via `saveBase64Image()`
6. Inserts row into `generations` table
7. Returns: `{ sessionId, generations: Array<{ id, imageUrl, metaPrompt, archetype, aspectRatio, variantNumber }> }`

## /api/score (POST)
Body: `{ generationId }`

1. Fetches generation row from DB (image_url, brief_json, archetype)
2. Reads image from UPLOAD_DIR as base64
3. Calls `scoreCreative(imageBase64, mimeType, brief)` → Gemini Vision
4. Inserts score into `scores` table (UNIQUE on generation_id → ON CONFLICT DO NOTHING prevents duplicates)
5. Returns: `{ scoring: ScoringResult }`

On failure: returns `{ error: "Score unavailable for this creative." }` — never blocks image display.

## /api/upload (POST)
FormData with `logo` field. Allowed: PNG, SVG, JPG, WebP. Max 5MB.
Saves via `saveLogo()`, returns `{ logoUrl }`.

## /api/library (GET)
Query params: `limit` (max 100, default 50), `offset` (default 0).
JOINs generations → sessions → scores. Filters by `sessions.username`. Returns reverse-chronological list with score data.

## /api/files/[filename] (GET)
Serves files from UPLOAD_DIR. Path traversal protected (uses `path.basename()`). Sets `Cache-Control: immutable` since filenames contain timestamps.

## /api/health (GET)
Returns `{ status: "ok", timestamp }`. Used by Railway healthcheck.

## /api/db-init (POST)
Runs `initDb()` to create tables/indexes. Requires `Authorization: Bearer <JWT_SECRET>` header. Run once after first deploy.
