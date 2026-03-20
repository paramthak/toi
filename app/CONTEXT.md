# app/ — Next.js App Router

## Pages
| Route | File | Description |
|---|---|---|
| `/` | `page.tsx` | Redirects → `/chat` if authed, `/login` if not |
| `/login` | `login/page.tsx` | Login form. Posts to `/api/auth`. Sets `creativeiq_token` cookie on success. |
| `/chat` | `chat/page.tsx` | Main chat interface. Accepts optional `?brief=<JSON>` query param for library iterate. |
| `/product` | `product/page.tsx` | Quick-form interface for users who know their brief. |
| `/library` | `library/page.tsx` | Gallery of all generated creatives. Download + iterate. |

## API Routes
| Route | Method | Description |
|---|---|---|
| `/api/auth` | POST | Login — validates credentials, sets JWT cookie |
| `/api/auth` | DELETE | Logout — clears JWT cookie |
| `/api/chat` | POST | Sends message to Gemini Flash chat. Parses `<BRIEF_JSON>` blocks. |
| `/api/generate` | POST | Assembles meta prompt → generates image(s) via Gemini → saves to DB + storage |
| `/api/score` | POST | Scores a generation via Gemini Vision → saves to DB |
| `/api/upload` | POST | Handles logo upload (PNG/SVG, max 5MB) → saves to UPLOAD_DIR |
| `/api/library` | GET | Returns all generations for the logged-in user, with scores, reverse chron |
| `/api/files/[filename]` | GET | Serves uploaded/generated files from UPLOAD_DIR |
| `/api/health` | GET | Health check for Railway (`{ status: "ok" }`) |
| `/api/db-init` | POST | One-time DB schema init (requires Bearer JWT_SECRET) |

## Layout
`layout.tsx` — root layout with metadata. Sets dark background. No nav here — each protected page imports NavBar directly.

## Auth pattern
All protected pages are server components that call `getAuthUser()` from `lib/auth.ts`. If null → `redirect('/login')`. The middleware (`/middleware.ts`) also guards all routes at the edge.
