# CreativeIQ — Project Context

## What this is
AI-powered static ad creative generator for Instagram. Internal tool for Leap Scholar marketing, HR, and programme management teams. Takes user intent (persona, goal, CTA, product) → generates image creative → scores it against a CTR prediction model → delivers actionable improvement tips.

## The core problem it solves
Internal teams produce ~0.5% CTR Instagram ads. The bottleneck is a knowledge gap — no access to the psychological/visual principles that drive high-CTR creatives. CreativeIQ encodes those principles into both the generation pipeline and a post-gen scoring engine.

## MVP success criteria
- Marketing team generates 10 creatives using CreativeIQ
- All 10 achieve CTR above 0.5% baseline on Instagram
- At least 5 score ≥75/100 on the CreativeIQ audit before launch

## Two interfaces
1. **Chat** — conversational AI creative strategist. Collects context across 6 dimensions, silently selects archetype, shows brief preview, triggers generation on confirm. Primary iteration mechanism is continued chat.
2. **Product (Form)** — for users who already know their brief. Single-screen form, system makes all strategic decisions automatically.

## Tech stack
| Layer | Technology |
|---|---|
| Frontend | Next.js 14 App Router · Mobile-first · TailwindCSS |
| Backend | Node.js API routes (Next.js monorepo) |
| Image generation | gemini-3-pro-image-preview |
| Prompt building | gemini-1.5-flash (Gemini Flash) |
| Post-gen scoring | gemini-1.5-flash with image input (Gemini Vision) |
| Database | Neon Serverless PostgreSQL |
| File storage | Railway volume (UPLOAD_DIR env var, ./uploads locally) |
| Auth | Username + password → JWT (jose for Edge/middleware, jsonwebtoken for Node) |
| Hosting | Railway (single service, monolith) |

## Required environment variables
```
ADMIN_USERNAME      # Login username (default: okok)
ADMIN_PASSWORD      # Login password (default: okok)
JWT_SECRET          # Secret for JWT signing — use a strong random string in prod
GEMINI_API_KEY      # Google Gemini API key
DATABASE_URL        # Neon Postgres connection string
UPLOAD_DIR          # File storage path (default: ./uploads, use /uploads on Railway)
NEXT_PUBLIC_APP_URL # App URL (e.g. https://creativeiq.up.railway.app)
```

## Request lifecycle (Chat)
1. User uploads logo → begins chat session
2. Gemini Flash (chat system prompt) collects signal across 6 dimensions: persona, JTBD, product, pain/aspiration, platform, brand
3. Flash silently infers best creative archetype (8 archetypes) from collected signals
4. System presents a brief preview to user for confirmation (includes BRIEF_JSON block parsed by the app)
5. On confirm: Gemini Flash assembles meta prompt from brief → sends to gemini-3-pro-image-preview
6. Generated image returned and displayed immediately
7. In background: Gemini Vision evaluates image against 7-factor scoring model (30–45s delay acceptable)
8. Score (0–100), label, and improvement tips surfaced in UI and as a chat message
9. User iterates via chat — system updates meta prompt and regenerates

## The scoring model (two-tier)
**Tier 1 — ScrollStop Gate (prerequisite):**
```
Gate = (visual_hook_score ^ 0.6) × (pattern_interrupt_score ^ 0.4)
If Gate < 0.50 → Final Score capped at 45
```

**Tier 2 — ClickThrough Score (7 weighted factors):**
```
visual_hierarchy (22%) + psychological_trigger (20%) + human_element (15%) +
cta_execution (13%) + information_architecture (12%) + color_contrast (10%) + platform_fit (8%)
```

**Final = ScrollStop_Gate × (ClickThrough / 100) × 100**

Score labels: Elite (90–100) · Launch Ready (80–89) · Conditional Launch (75–79) · Revise First (65–74) · Significant Rebuild (50–64) · Do Not Launch (<50)

## The 8 creative archetypes (selected silently)
UGC_STYLE · UGLY_ANTI_DESIGN · MINIMALIST · HIGH_INFORMATION · MEME_IFIED · BEFORE_AFTER · TESTIMONIAL_SCREENSHOT · PATTERN_INTERRUPT

## Directory structure
```
app/              Next.js App Router pages + API routes
components/       React client components (chat, product, library, ui)
lib/              Core logic (auth, db, gemini, storage, prompts, utils)
scripts/          DB migration script
uploads/          Local file storage (Railway volume in prod)
```

## Out of scope for MVP
Multi-user accounts · Direct Instagram publishing · Real-time CTR feedback loop · CV pipelines (saliency, gaze, face detection) · Video/animated formats · Google Display / LinkedIn / TikTok
