# components/ — React Client Components

All components are `'use client'` unless noted. Server components live in `app/`.

## components/chat/

### ChatInterface.tsx
The core UI for the Chat interface. Manages the full conversation state:
- `messages` — displayed chat messages (user + assistant)
- `geminiHistory` — Gemini API format history sent with each request
- `sessionId` — Neon Postgres session UUID, created on first message
- `logoUrl` — URL of uploaded logo (stored in UPLOAD_DIR)
- `generations` — array of generated creatives with scores
- `pendingBrief` — set when Gemini returns a `<BRIEF_JSON>` block; shows Confirm/Adjust buttons
- `isGenerating` — shows the pulsing placeholder while image generates

**Flow:**
1. User types → `handleSend()` → POST `/api/chat` → Gemini Flash responds
2. If response contains `<BRIEF_JSON>`, `pendingBrief` is set and Confirm/Adjust buttons appear
3. On confirm → `triggerGeneration()` → POST `/api/generate` → images appear one by one
4. Score fetched in background per generation → ScoreCard appears with 30–45s delay
5. Score result is also injected as a chat message for iteration context

### CreativeOutput.tsx
Right panel (desktop) / bottom drawer (mobile) showing generated images.
- Variant selector tabs with score badges
- Image with aspect-ratio-aware container
- Download button
- Hands off to ScoreCard for score display

## components/product/

### ProductForm.tsx
Single-screen form for the Product interface. Fields: persona, CTA, product description, aspect ratios (multi-select), creative style dropdown (AUTO or specific archetype), logo upload, variant count (1–10 slider).

Validation blocks submission if persona < 20 chars, CTA empty, product < 10 chars, no logo, no aspect ratio selected.

When `archetype === 'AUTO'`, sends `'AUTO_SELECT'` as the archetype value — the meta prompt assembler handles this by selecting the best archetype itself.

## components/library/

### CreativeLibrary.tsx
Loads from `GET /api/library`. Renders a responsive grid. Each card shows:
- Generated image (aspect-ratio-correct container)
- Score badge (colour-coded)
- On click: full modal with score label, brief summary, Download + Iterate buttons

**Iterate** navigates to `/chat?brief=<URL-encoded JSON>` which preloads the brief in ChatInterface for iteration from a previous session.

## components/ui/

### NavBar.tsx
Fixed bottom nav on mobile, fixed top nav on desktop. Three tabs: Chat · Quick Form · Library. Sign-out button (calls DELETE `/api/auth` then redirects to `/login`).

### ScoreCard.tsx
Displays scoring results from Gemini Vision:
- Animated SVG score ring (colour: green ≥80, yellow ≥65, orange ≥50, red <50)
- Score label badge (colour-coded per threshold)
- Scroll-stop diagnosis text
- Per-factor bar chart (7 factors, weighted %)
- Improvement tips (priority-numbered, impact-coloured)
- Loading state (shimmer skeleton) while score is computing
