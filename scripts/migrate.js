// Run: node scripts/migrate.js
// Make sure DATABASE_URL is set in .env.local

require('dotenv').config({ path: '.env.local' })

const { neon } = require('@neondatabase/serverless')

async function migrate() {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL not set in .env.local')
    process.exit(1)
  }

  const sql = neon(process.env.DATABASE_URL)

  console.log('Running migrations...')

  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at TIMESTAMP DEFAULT NOW(),
      interface TEXT CHECK (interface IN ('chat', 'product')),
      username TEXT NOT NULL
    )
  `
  console.log('✓ sessions table')

  await sql`
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
    )
  `
  console.log('✓ generations table')

  await sql`
    CREATE TABLE IF NOT EXISTS scores (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      generation_id UUID REFERENCES generations(id) ON DELETE CASCADE UNIQUE,
      created_at TIMESTAMP DEFAULT NOW(),
      raw_response JSONB,
      final_score FLOAT,
      score_label TEXT,
      scroll_stop_gate FLOAT,
      gate_passed BOOLEAN
    )
  `
  console.log('✓ scores table')

  await sql`CREATE INDEX IF NOT EXISTS idx_generations_session ON generations(session_id)`
  await sql`CREATE INDEX IF NOT EXISTS idx_scores_generation ON scores(generation_id)`
  await sql`CREATE INDEX IF NOT EXISTS idx_generations_created ON generations(created_at DESC)`
  console.log('✓ indexes')

  console.log('\nMigration complete!')
  process.exit(0)
}

migrate().catch(err => {
  console.error('Migration failed:', err)
  process.exit(1)
})
