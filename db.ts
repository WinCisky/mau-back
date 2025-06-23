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
      ALTER TABLE episodes
      ADD CONSTRAINT fk_anime_id FOREIGN KEY (anime_id) REFERENCES animes(id)
      ON DELETE CASCADE;
    `;
  } finally {
    connection.release();
  }
}

export async function saveEpisode(episode: {
  slug: string;
  episode_number: number;
  anime_id: number;
  episode_id?: number | null;
}) {
  const connection = await pool.connect();
  try {
    await connection.queryObject`
      INSERT INTO episodes (slug, episode_number, anime_id, id)
      VALUES (${episode.slug}, ${episode.episode_number}, ${episode.anime_id}, ${episode.episode_id})
      ON CONFLICT (anime_id, episode_number) DO UPDATE SET
        slug = EXCLUDED.slug,
        id = EXCLUDED.id,
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
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        slug = EXCLUDED.slug,
        image_url = EXCLUDED.image_url,
        description = EXCLUDED.description,
        updated_at = CURRENT_TIMESTAMP;
    `;
  } finally {
    connection.release();
  }
}

// return anime slug and episode slug
export async function getEpisodeSlugInfoAndId(animeId: number, episodeNumber: number) {
  const connection = await pool.connect();
  try {
    const result = await connection.queryObject`
      SELECT a.slug AS anime_slug, e.slug AS episode_slug, e.id AS episode_id
      FROM animes a
      JOIN episodes e ON a.id = e.anime_id
      WHERE a.id = ${animeId} AND e.episode_number = ${episodeNumber};
    `;
    return result.rows[0] || null;
  } finally {
    connection.release();
  }
}

// return episode id from anime id and episode number
export async function getEpisodeId(animeId: number, episodeNumber: number) {
  const connection = await pool.connect();
  try {
    const result = await connection.queryObject`
      SELECT id FROM episodes
      WHERE anime_id = ${animeId} AND episode_number = ${episodeNumber};
    `;
    return result.rows[0]?.id || null;
  } finally {
    connection.release();
  }
}