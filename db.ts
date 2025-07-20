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
        dubbed BOOLEAN DEFAULT FALSE,
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

      CREATE TABLE IF NOT EXISTS related (
        id SERIAL,
        anime_id INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id, anime_id)
      );

      CREATE INDEX IF NOT EXISTS idx_episodes_anime_id ON episodes (anime_id);
      CREATE INDEX IF NOT EXISTS idx_episodes_episode_number ON episodes (episode_number);
      CREATE INDEX IF NOT EXISTS idx_related_anime_id ON related (anime_id);
      CREATE INDEX IF NOT EXISTS idx_related_id ON related (id);

      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints 
          WHERE constraint_name = 'fk_episodes_anime_id' 
          AND table_name = 'episodes'
        ) THEN
          ALTER TABLE episodes
          ADD CONSTRAINT fk_episodes_anime_id FOREIGN KEY (anime_id) REFERENCES animes(id)
          ON DELETE CASCADE;
        END IF;
      END $$;

      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints 
          WHERE constraint_name = 'fk_related_anime_id' 
          AND table_name = 'related'
        ) THEN
          ALTER TABLE related
          ADD CONSTRAINT fk_related_anime_id FOREIGN KEY (anime_id) REFERENCES animes(id)
          ON DELETE CASCADE;
        END IF;
      END $$;
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
  dubbed?: boolean | null;
}) {
  const connection = await pool.connect();
  try {
    await connection.queryObject`
      INSERT INTO animes (id, slug, name, image_url, description, dubbed)
      VALUES (${anime.id}, ${anime.slug}, ${anime.name}, ${anime.image_url}, ${anime.description}, ${anime.dubbed})
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        slug = EXCLUDED.slug,
        image_url = EXCLUDED.image_url,
        description = EXCLUDED.description,
        updated_at = CURRENT_TIMESTAMP,
        dubbed = EXCLUDED.dubbed;
    `;
  } finally {
    connection.release();
  }
}

// Create a new relation group and return the new relation ID
export async function createNewRelation(animeId: number) {
  const connection = await pool.connect();
  try {
    const result = await connection.queryObject`
      INSERT INTO related (anime_id)
      VALUES (${animeId})
      RETURNING id;
    `;
    return result.rows[0]?.id || null;
  } finally {
    connection.release();
  }
}

// Add an anime to an existing relation group
export async function addAnimeToRelation(relatedId: number, animeId: number) {
  const connection = await pool.connect();
  try {
    await connection.queryObject`
      INSERT INTO related (id, anime_id)
      VALUES (${relatedId}, ${animeId})
      ON CONFLICT (id, anime_id) DO NOTHING;
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

// return related anime id
export async function getRelatedAnimeId(animeId: number) {
  const connection = await pool.connect();
  try {
    const result = await connection.queryObject`
      SELECT id FROM related
      WHERE anime_id = ${animeId};
    `;
    return result.rows[0]?.id || null;
  } finally {
    connection.release();
  }
}

// return all related anime for a given anime id
export async function getRelatedAnime(animeId: number) {
  const connection = await pool.connect();
  try {
    const result = await connection.queryObject`
      SELECT a.id, a.slug, a.name, a.image_url, a.description, a.dubbed
      FROM related r
      JOIN animes a ON r.id = a.id
      WHERE r.anime_id = ${animeId};
    `;
    return result.rows;
  } finally {
    connection.release();
  }
}