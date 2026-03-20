# scripts/ — Utility Scripts

## migrate.js
Runs the Neon Postgres schema migration. Creates all tables and indexes if they don't exist (idempotent — safe to run multiple times).

**Usage:**
```bash
npm run db:migrate
```

Requires `DATABASE_URL` to be set in `.env.local` (reads via dotenv). Also works if DATABASE_URL is set as a shell env var.

**Tables created:**
- `sessions` — one per chat/form session (id, created_at, interface, username)
- `generations` — one per generated image (id, session_id, brief_json, archetype, meta_prompt, image_url, aspect_ratio, variant_number, parent_id)
- `scores` — one per generation, UNIQUE on generation_id (id, generation_id, raw_response, final_score, score_label, scroll_stop_gate, gate_passed)

**Indexes:**
- `idx_generations_session` — fast lookup of generations by session
- `idx_scores_generation` — fast join of scores to generations
- `idx_generations_created` — fast chronological library queries

**When to run:** Once after first deploy to Railway. If you add new columns or tables later, add `ALTER TABLE IF NOT EXISTS` statements here and re-run.
