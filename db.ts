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
        id INTEGER,
        slug TEXT NOT NULL,
        episode_number INTEGER NOT NULL,
        anime_id INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (anime_id, episode_number)
      );
      CREATE TABLE IF NOT EXISTS animes (
        id INTEGER PRIMARY KEY,
        slug TEXT NOT NULL,
        name TEXT,
        image_url TEXT,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_episodes_anime_id ON episodes (anime_id);
      CREATE INDEX IF NOT EXISTS idx_episodes_episode_number ON episodes (episode_number);
    `;
  } finally {
    connection.release();
  }
}

export async function saveEpisode(episode: {
  slug: string;
  episode_number: number;
  anime_id: number;
}) {
  const connection = await pool.connect();
  try {
    await connection.queryObject`
      INSERT INTO episodes (slug, episode_number, anime_id)
      VALUES (${episode.slug}, ${episode.episode_number}, ${episode.anime_id})
      ON CONFLICT (slug) DO UPDATE SET
        episode_number = EXCLUDED.episode_number,
        anime_id = EXCLUDED.anime_id,
        updated_at = CURRENT_TIMESTAMP;
    `;
  } finally {
    connection.release();
  }
}

export async function saveAnime(anime: {
  id: number;
  slug: string;
  name?: string | null;
  image_url?: string | null;
  description?: string | null;
}) {
  const connection = await pool.connect();
  try {
    await connection.queryObject`
      INSERT INTO animes (id, slug, name, image_url, description)
      VALUES (${anime.id}, ${anime.slug}, ${anime.name}, ${anime.image_url}, ${anime.description})
      ON CONFLICT (slug) DO UPDATE SET
        name = EXCLUDED.name,
        image_url = EXCLUDED.image_url,
        description = EXCLUDED.description,
        updated_at = CURRENT_TIMESTAMP;
    `;
  } finally {
    connection.release();
  }
}