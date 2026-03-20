# lib/ — Core Logic

## lib/auth.ts
JWT-based auth utilities (Node.js runtime — not Edge).
- `signToken(username)` — signs a 7-day JWT with JWT_SECRET
- `verifyToken(token)` — verifies and decodes JWT, returns null on failure
- `validateCredentials(username, password)` — compares against ADMIN_USERNAME/ADMIN_PASSWORD env vars
- `getAuthUser()` — reads `creativeiq_token` cookie from Next.js `cookies()`, verifies it, returns payload or null
- Used in all API routes to authenticate requests

Note: Middleware uses `jose` (Edge-compatible) for the same verification. `lib/auth.ts` uses `jsonwebtoken` (Node.js only, used in API routes and server components).

## lib/db.ts
Neon Serverless PostgreSQL client.
- `getDb()` — lazily initialises the neon SQL executor from DATABASE_URL
- `query<T>(sql, params?)` — executes parameterised queries, returns typed rows
- `initDb()` — creates all tables and indexes if they don't exist (called by `/api/db-init`)

## lib/gemini.ts
All Gemini API calls. Uses `@google/generative-ai`.

### Functions:
- `sendChatMessage(history, userMessage, systemPrompt)` — Gemini Flash chat call, returns assistant text
- `assemblMetaPrompt(brief)` — sends brief JSON to Gemini Flash with meta prompt assembler system prompt, returns the assembled image generation prompt string
- `generateImage(metaPrompt)` — sends prompt to `gemini-3-pro-image-preview`, returns `{ base64Data, mimeType }` from the inline image response
- `scoreCreative(imageBase64, mimeType, brief)` — sends image + brief to Gemini Vision (gemini-1.5-flash), returns parsed `ScoringResult` JSON

## lib/storage.ts
Local filesystem / Railway volume file I/O.
- `getUploadDir()` — resolves UPLOAD_DIR (default: ./uploads), creates if missing
- `saveBase64Image(base64, mimeType, filename?)` — saves generated image, returns `/api/files/<name>` URL
- `saveLogo(buffer, originalName)` — saves uploaded logo, returns `/api/files/<name>` URL
- `getFilePath(filename)` — resolves absolute path for a stored file
- `fileExists(filename)` — checks if file exists in UPLOAD_DIR
- `readFileAsBase64(filename)` — reads file from UPLOAD_DIR and returns base64 string (used by score route to pass image to Gemini Vision)

## lib/utils.ts
Shared utilities used by components.
- `cn(...classes)` — clsx + tailwind-merge for conditional classnames
- `getScoreBadgeStyle(label)` — returns Tailwind classes for score label badges
- `getScoreRingColor(score)` — returns hex colour for SVG score ring
- `formatDate(dateString)` — formats ISO date to readable string

## lib/prompts/

### chatSystemPrompt.ts
The exact master system prompt for the Gemini Flash chat session (verbatim from PRD Section 5). Covers:
- Conversation rules (one question at a time, 3–8 questions, no jargon)
- 6 signal dimensions to collect (PERSONA, JTBD, PRODUCT, PAIN/ASPIRATION, PLATFORM, BRAND)
- Archetype selection logic (8 archetypes with weighted scoring)
- Brief presentation format (with embedded `<BRIEF_JSON>...</BRIEF_JSON>` block that the app parses)
- Post-generation iteration instructions

### metaPromptAssembler.ts
System prompt for the Gemini Flash meta prompt assembly call (verbatim from PRD Section 6). Covers:
- Scroll-stop mechanics (35% weight)
- Psychological triggers (20%)
- Human element rules (15%)
- CTA execution (13%)
- Information density limits (12%)
- Color principles (10%)
- Archetype-specific directives (one section per archetype)
- Prompt assembly format (structured output sections)

Also exports `BriefJSON` interface and `buildMetaPromptUserMessage()`.

### scoringPrompt.ts
System prompt for the Gemini Vision scoring call (verbatim from PRD Section 8.4). Instructs the model to:
- Output only valid JSON in a specific schema
- Score 7 factors (0–100 integers, gate scores as floats)
- Apply the two-tier formula
- Return 2–4 specific, non-generic improvement tips

Also exports `getScoreLabel()`, `getScoreColor()`, `getScoreAction()` helpers.
