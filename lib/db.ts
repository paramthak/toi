import { neon } from '@neondatabase/serverless'

// Create a SQL executor — works in both Neon serverless and local pg
let sql: ReturnType<typeof neon>

export function getDb() {
  if (!sql) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is not set')
    }
    sql = neon(process.env.DATABASE_URL)
  }
  return sql
}

export async function query<T = Record<string, unknown>>(
  queryText: string,
  params?: unknown[]
): Promise<T[]> {
  const db = getDb()
  if (params && params.length > 0) {
    // Build tagged template literal dynamically
    const result = await db(queryText, params)
    return result as T[]
  }
  const result = await db(queryText)
  return result as T[]
}

// For transactions using raw postgres
export async function initDb() {
  const db = getDb()
  await db(`
    CREATE TABLE IF NOT EXISTS sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at TIMESTAMP DEFAULT NOW(),
      interface TEXT CHECK (interface IN ('chat', 'product')),
      username TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS generations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT NOW(),
      brief_json JSONB,
      archetype TEXT,
      meta_prompt TEXT,
      image_url TEXT,
      aspect_ratio TEXT,
      variant_number INT DEFAULT 1,
      parent_id UUID REFERENCES generations(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS scores (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      generation_id UUID REFERENCES generations(id) ON DELETE CASCADE UNIQUE,
      created_at TIMESTAMP DEFAULT NOW(),
      raw_response JSONB,
      final_score FLOAT,
      score_label TEXT,
      scroll_stop_gate FLOAT,
      gate_passed BOOLEAN
    );

    CREATE INDEX IF NOT EXISTS idx_generations_session ON generations(session_id);
    CREATE INDEX IF NOT EXISTS idx_scores_generation ON scores(generation_id);
    CREATE INDEX IF NOT EXISTS idx_generations_created ON generations(created_at DESC);
  `)
  console.log('Database initialized successfully')
}
