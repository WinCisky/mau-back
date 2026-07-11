import { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { Database } from './database.types.ts'

const CACHE_TTL_MS = 10 * 60 * 1000;
const ANIME_EPISODES_REFRESH_MS = 24 * 60 * 60 * 1000;
const ANIMEWORLD_BASE_URL = "https://www.animeworld.ac";

export const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
  "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "GET, OPTIONS",
};

export async function handleLink(supabase: SupabaseClient<Database>, params: URLSearchParams): Promise<Response> {
  const id = params.get("id");

  if (!id) {
    return json({ error: "missing id value" }, 400);
  }

  const cachedGrabber = await getCachedGrabber(supabase, id);

  if (cachedGrabber) {
    return json({ grabber: cachedGrabber });
  }

  const { data: episodeRow, error: episodeError } = await supabase
    .from("episodes")
    .select("animes!fk_episodes_anime_id(slug)")
    // .select("animes!fk_episodes_anime_id ( id, slug )")
    .eq("slug", id)
    .limit(1)
    .single()

  if (episodeError || !episodeRow) {
    return json({ error: episodeError.message }, 500);
  }

  // const episodes 
  const animeSlug = episodeRow.animes.slug;

  if (!animeSlug) {
    return json({ error: "not found" }, 404);
  }

  const animeworldPayload = await fetchAnimeworldEpisodeInfo(id, animeSlug);

  const grabber = getStringProperty(animeworldPayload, "grabber");

  if (grabber) {
    await cacheGrabber(supabase, id, grabber);
  }

  return json(animeworldPayload);
}

export async function handleEpisodes(supabase: SupabaseClient<Database>, params: URLSearchParams): Promise<Response> {
  const anime = parseInt(params.get("anime") ?? "0");

  if (anime === 0) {
    return json({ error: "missing anime value" }, 400);
  }

  const populated = await populateEpisodesForAnime(supabase, anime);

  if (!populated.ok) {
    return json({ error: populated.error }, populated.status);
  }

  const { data, error } = await supabase
    .from("episodes")
    .select(
      "id, slug, episode_number, created_at, animes!fk_episodes_anime_id!inner ( slug )",
    )
    .eq("animes.id", anime)
    .order("episode_number", { ascending: true });

  if (error) {
    return json({ error: error.message }, 500);
  }

  const episodes = data ?? [];
  const episodeNumbers = episodes
    .map((episode) => episode.episode_number)
    .filter((episodeNumber): episodeNumber is number =>
      typeof episodeNumber === "number"
    );

  return json({
    episodes,
    first_episode_number: episodeNumbers.at(0) ?? null,
    last_episode_number: episodeNumbers.at(-1) ?? null,
  });
}

export async function handleSyncLatestEpisodes(supabase: SupabaseClient<Database>, params: URLSearchParams): Promise<Response> {
  const pages = parsePositiveInteger(params.get("pages"), 1);

  if (pages > 5) {
    return json({ error: "pages must be between 1 and 5" }, 400);
  }

  const result = await syncLatestAnimeworldEpisodes(supabase, pages);

  return json(result);
}

type PopulateResult =
  | { ok: true; episodesFound: number }
  | { ok: false; status: number; error: string };

type ScrapedEpisode = {
  slug: string;
  episode_number: number;
};

type ScrapedUpdatedEpisode = {
  anime_id: number;
  anime_slug: string;
  anime_name: string;
  alt_name: string | null;
  image_url: string | null;
  episode_slug: string;
  episode_number: number;
  dubbed: boolean;
};

async function populateEpisodesForAnime(
    supabase: SupabaseClient<Database>,
    animeId: number,
): Promise<PopulateResult> {
  const freshAfter = new Date(Date.now() - ANIME_EPISODES_REFRESH_MS).toISOString();

  const { data: animeRow, error: animeError } = await supabase
    .from("animes")
    .select("id, slug, updated_at")
    .eq("id", animeId)
    .lt("updated_at", freshAfter)
    .limit(1)
    .maybeSingle();

  if (animeError) {
    return { ok: false, status: 500, error: animeError.message };
  }

  if (!animeRow?.id) {
    return { ok: false, status: 404, error: "anime not found or already updated" };
  }

  const page = await fetchAnimeworldPlayPage(animeRow.slug);
  const episodes = scrapeAnimeworldEpisodes(page.html, animeRow.slug);
  console.log(episodes)

  if (episodes.length === 0) {
    return { ok: false, status: 404, error: "episodes not found" };
  }

  const { data: existingEpisodes, error: existingEpisodesError } = await supabase
    .from("episodes")
    .select("slug")
    .in("slug", episodes.map((episode) => episode.slug));

  if (existingEpisodesError) {
    return { ok: false, status: 500, error: existingEpisodesError.message };
  }

  const existingSlugs = new Set(
    (existingEpisodes ?? []).map((episode) => episode.slug),
  );
  const existingRows = episodes.filter((episode) =>
    existingSlugs.has(episode.slug)
  );
  const newRows = episodes.filter((episode) => !existingSlugs.has(episode.slug));

  const { error: upsertError } = existingRows.length > 0
    ? await supabase
      .from("episodes")
      .upsert(
        existingRows.map((episode) => ({
          anime_id: animeRow.id,
          slug: episode.slug,
          episode_number: episode.episode_number,
        })),
        { onConflict: "slug" },
      )
    : { error: null };

  if (upsertError) {
    return { ok: false, status: 500, error: upsertError.message };
  }

  const { error: insertError } = newRows.length > 0
    ? await supabase
      .from("episodes")
      .insert(
        newRows.map((episode) => ({
          anime_id: animeRow.id,
          slug: episode.slug,
          episode_number: episode.episode_number,
          created_at: "1990-01-01T00:00:00.000Z",
          updated_at: "1990-01-01T00:00:00.000Z",
        })),
      )
    : { error: null };

  if (insertError) {
    return { ok: false, status: 500, error: insertError.message };
  }

  return { ok: true, episodesFound: episodes.length };
}

export async function syncLatestAnimeworldEpisodes(supabase: SupabaseClient<Database>, pages = 1): Promise<{
  ok: boolean;
  pagesScraped: number;
  animesFound: number;
  episodesFound: number;
  error?: string;
}> {
  try {
    const latestEpisodes = new Map<string, ScrapedUpdatedEpisode>();

    for (let pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
      const page = await fetchAnimeworldUpdatedPage(pageNumber);

      for (const episode of scrapeAnimeworldUpdatedEpisodes(page.html)) {
        latestEpisodes.set(episode.episode_slug, episode);
      }
    }

    const latestEpisodeRows = [...latestEpisodes.values()];

    if (latestEpisodeRows.length === 0) {
      console.error("sync-latest-episodes found no episodes");
      return {
        ok: false,
        pagesScraped: pages,
        animesFound: 0,
        episodesFound: 0,
        error: "episodes not found",
      };
    }

    const latestByAnimeId = new Map<number, ScrapedUpdatedEpisode>();

    for (const episode of latestEpisodeRows) {
      latestByAnimeId.set(episode.anime_id, episode);
    }

    const now = new Date().toISOString();
    const { error: animeError } = await supabase
      .from("animes")
      .upsert(
        [...latestByAnimeId.values()].map((episode) => ({
          id: episode.anime_id,
          slug: episode.anime_slug,
          name: episode.anime_name,
          image_url: episode.image_url,
          alt_name: episode.alt_name,
          dubbed: episode.dubbed,
          updated_at: now,
        })),
        { onConflict: "id" },
      );

    if (animeError) {
      console.error("sync-latest-episodes anime upsert failed", animeError);
      return {
        ok: false,
        pagesScraped: pages,
        animesFound: latestByAnimeId.size,
        episodesFound: latestEpisodeRows.length,
        error: animeError.message,
      };
    }

    const { data: existingEpisodes, error: existingEpisodesError } = await supabase
      .from("episodes")
      .select("id, slug")
      .in("slug", latestEpisodeRows.map((episode) => episode.episode_slug));

    if (existingEpisodesError) {
      console.error("sync-latest-episodes episode lookup failed", existingEpisodesError);
      return {
        ok: false,
        pagesScraped: pages,
        animesFound: latestByAnimeId.size,
        episodesFound: latestEpisodeRows.length,
        error: existingEpisodesError.message,
      };
    }

    const existingEpisodeIds = new Map(
      (existingEpisodes ?? [])
        .filter((episode): episode is { id: number; slug: string } =>
          typeof episode.id === "number"
        )
        .map((episode) => [episode.slug, episode.id]),
    );
    const rowsToUpdate = latestEpisodeRows
      .filter((episode) => existingEpisodeIds.has(episode.episode_slug))
      .map((episode) => ({
        id: existingEpisodeIds.get(episode.episode_slug)!,
        anime_id: episode.anime_id,
        slug: episode.episode_slug,
        episode_number: episode.episode_number,
        updated_at: now,
      }));
    const rowsToInsert = latestEpisodeRows
      .filter((episode) => !existingEpisodeIds.has(episode.episode_slug))
      .map((episode) => ({
        anime_id: episode.anime_id,
        slug: episode.episode_slug,
        episode_number: episode.episode_number,
        updated_at: now,
      }));

    const { error: episodeUpdateError } = rowsToUpdate.length > 0
      ? await supabase
        .from("episodes")
        .upsert(rowsToUpdate, { onConflict: "id" })
      : { error: null };

    if (episodeUpdateError) {
      console.error("sync-latest-episodes episode update failed", episodeUpdateError);
      return {
        ok: false,
        pagesScraped: pages,
        animesFound: latestByAnimeId.size,
        episodesFound: latestEpisodeRows.length,
        error: episodeUpdateError.message,
      };
    }

    const { error: episodeInsertError } = rowsToInsert.length > 0
      ? await supabase.from("episodes").insert(rowsToInsert)
      : { error: null };

    if (episodeInsertError) {
      console.error("sync-latest-episodes episode insert failed", episodeInsertError);
      return {
        ok: false,
        pagesScraped: pages,
        animesFound: latestByAnimeId.size,
        episodesFound: latestEpisodeRows.length,
        error: episodeInsertError.message,
      };
    }

    return {
      ok: true,
      pagesScraped: pages,
      animesFound: latestByAnimeId.size,
      episodesFound: latestEpisodeRows.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.error("sync-latest-episodes failed", error);
    return {
      ok: false,
      pagesScraped: pages,
      animesFound: 0,
      episodesFound: 0,
      error: message,
    };
  }
}

export async function runScheduledTask(supabase: SupabaseClient<Database>): Promise<void> {
  const expiredBefore = new Date(Date.now() - CACHE_TTL_MS).toISOString();

  const { error } = await supabase
    .from("cache")
    .delete()
    .lt("created_at", expiredBefore);

  if (error) {
    console.error("scheduled-task failed", error);
  }
}

async function getCachedGrabber(supabase: SupabaseClient<Database>, id: string): Promise<string | null> {
  const freshAfter = new Date(Date.now() - CACHE_TTL_MS).toISOString();

  const { data, error } = await supabase
    .from("cache")
    .select("url")
    .eq("id", id)
    .gte("created_at", freshAfter)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data?.url ?? null;
}

async function cacheGrabber(supabase: SupabaseClient<Database>, id: string, grabber: string): Promise<void> {
  const { error } = await supabase
    .from("cache")
    .upsert(
      { id, created_at: new Date().toISOString(), url: grabber },
      { onConflict: "id" },
    );

  if (error) {
    console.error("cache upsert failed", error);
  }
}

async function fetchAnimeworldEpisodeInfo(
  episodeSlug: string,
  animeSlug: string,
): Promise<Record<string, unknown>> {
  const websiteUrl = `${ANIMEWORLD_BASE_URL}/api/episode/info?id=${
    encodeURIComponent(episodeSlug)
  }&alt=0`;
  const referer = `${ANIMEWORLD_BASE_URL}/play/${
    encodeURIComponent(animeSlug)
  }/${encodeURIComponent(episodeSlug)}`;

  const response = await fetch(websiteUrl, {
    headers: {
      accept: "application/json, text/javascript, */*; q=0.01",
      "content-type": "application/json",
      "csrf-token": generateRandomString(),
      "sec-ch-ua":
        '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "x-requested-with": "XMLHttpRequest",
      referer,
    },
    method: "GET",
  });

  if (!response.ok) {
    throw new Error(`AnimeWorld request failed with ${response.status}`);
  }

  return await response.json();
}

async function fetchAnimeworldPlayPage(
  animeSlug: string,
): Promise<{ html: string; url: string }> {
  const websiteUrl = `${ANIMEWORLD_BASE_URL}/play/${
    encodeURIComponent(animeSlug)
  }`;

  const response = await fetch(websiteUrl, {
    headers: {
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "sec-ch-ua":
        '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
    },
    method: "GET",
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`AnimeWorld play page request failed with ${response.status}`);
  }

  return { html: await response.text(), url: response.url };
}

async function fetchAnimeworldUpdatedPage(
  page = 1,
): Promise<{ html: string; url: string }> {
  const websiteUrl = page === 1
    ? `${ANIMEWORLD_BASE_URL}/updated`
    : `${ANIMEWORLD_BASE_URL}/updated?page=${page}`;

  const response = await fetch(websiteUrl, {
    headers: {
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "sec-ch-ua":
        '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
    },
    method: "GET",
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`AnimeWorld updated page request failed with ${response.status}`);
  }

  return { html: await response.text(), url: response.url };
}

function scrapeAnimeworldEpisodes(
  html: string,
  animeSlug: string,
): ScrapedEpisode[] {
  const slugPattern = escapeRegExp(animeSlug);
  const linkPattern = new RegExp(
    `<a\\b(?=[^>]*\\bhref=["']\\/play\\/${slugPattern}\\/([^"'?#/]+)["'])(?=[^>]*\\bdata-id=["']([^"']+)["'])(?=[^>]*\\bdata-episode-num=["']([^"']+)["'])[^>]*>([\\s\\S]*?)<\\/a>`,
    "gi",
  );
  const episodes = new Map<string, ScrapedEpisode>();

  for (const match of html.matchAll(linkPattern)) {
    const hrefSlug = decodeHtml(match[1]).trim();
    const dataId = decodeHtml(match[2]).trim();
    const episodeNumber = Number.parseFloat(decodeHtml(match[3]).trim());
    const slug = dataId || hrefSlug;

    if (!slug || !Number.isFinite(episodeNumber)) {
      continue;
    }

    episodes.set(slug, {
      slug,
      episode_number: episodeNumber,
    });
  }

  return [...episodes.values()].sort((first, second) =>
    first.episode_number - second.episode_number
  );
}

function scrapeAnimeworldUpdatedEpisodes(html: string): ScrapedUpdatedEpisode[] {
  const filmList = html.match(/<div\s+class=["']film-list["'][^>]*>([\s\S]*?)<div\s+class=["']clearfix["'][^>]*>/i)
    ?.[1] ?? "";
  const episodePattern = new RegExp(
    [
      `<a\\b(?=[^>]*\\bhref=["']\\/play\\/([^"'?#/]+)\\/([^"'?#/]+)["'])`,
      `(?=[^>]*\\bclass=["'][^"']*\\bposter\\b[^"']*["'])`,
      `(?=[^>]*\\bdata-tip=["'][^"']*\\/?api\\/tooltip\\/(\\d+)["'])[^>]*>`,
      `[\\s\\S]*?<img\\b[^>]*\\bsrc=["']([^"']+)["'][^>]*>`,
      `[\\s\\S]*?<div\\s+class=["']ep["'][^>]*>\\s*Ep\\s*([\\d.]+)\\s*<\\/div>`,
      `[\\s\\S]*?<a\\b(?=[^>]*\\bhref=["']\\/play\\/[^"'?#/]+\\/[^"'?#/]+["'])`,
      `(?=[^>]*\\bclass=["'][^"']*\\bname\\b[^"']*["'])`,
      `(?:[^>]*\\bdata-jtitle=["']([^"']*)["'])?[^>]*>([\\s\\S]*?)<\\/a>`,
    ].join(""),
    "gi",
  );
  const episodes = new Map<string, ScrapedUpdatedEpisode>();

  for (const match of filmList.matchAll(episodePattern)) {
    const animeSlug = decodeHtml(match[1]).trim();
    const episodeSlug = decodeHtml(match[2]).trim();
    const animeId = Number.parseInt(decodeHtml(match[3]).trim(), 10);
    const episodeNumber = Number.parseFloat(
      decodeHtml(match[5]).trim(),
    );
    const animeName = stripHtml(decodeHtml(match[7])).trim();
    const altName = match[6] ? decodeHtml(match[6]).trim() : null;
    const imageUrl = decodeHtml(match[4]).trim();

    if (
      !animeSlug ||
      !episodeSlug ||
      !animeName ||
      !Number.isFinite(animeId) ||
      !Number.isFinite(episodeNumber)
    ) {
      continue;
    }

    episodes.set(episodeSlug, {
      anime_id: animeId,
      anime_slug: animeSlug,
      anime_name: animeName,
      alt_name: altName || null,
      image_url: imageUrl || null,
      episode_slug: episodeSlug,
      episode_number: episodeNumber,
      dubbed: /\b(?:ita|dub)\b/i.test(animeSlug) || /\(ITA\)/i.test(animeName),
    });
  }

  return [...episodes.values()];
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, "");
}

function decodeHtml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, codePoint) =>
      String.fromCodePoint(Number(codePoint))
    )
    .replace(/&#x([\da-f]+);/gi, (_, codePoint) =>
      String.fromCodePoint(Number.parseInt(codePoint, 16))
    )
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function generateRandomString(length = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function getStringProperty(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function parsePositiveInteger(value: string | null, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: corsHeaders,
  });
}
