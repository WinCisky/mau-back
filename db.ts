import { Pool } from "jsr:@bartlomieju/postgres";
import { load } from "https://deno.land/std/dotenv/mod.ts";

const env = await load();
if (env.DATABASE_URL) {
  Deno.env.set("DATABASE_URL", env.DATABASE_URL);
}

const databaseUrl = Deno.env.get("DATABASE_URL")!;
const pool = new Pool(databaseUrl, 3, true);

// Funzione per eseguire le migrazioni (creazione tabella)
export async function runMigrations() {
  const connection = await pool.connect();
  try {
    await connection.queryObject`
      CREATE TABLE IF NOT EXISTS episodes (
        id SERIAL PRIMARY KEY,
        episode_link TEXT NOT NULL
        video_link TEXT NOT NULL,
        episode_number INTEGER NOT NULL,
        anime_id INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS animes (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        image_url TEXT NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;
  } finally {
    connection.release();
  }
}