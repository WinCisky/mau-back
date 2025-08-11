import { Hono } from "https://deno.land/x/hono@v3.4.1/mod.ts";
import { cors } from "https://deno.land/x/hono@v3.4.1/middleware.ts";

import {
  getAnimeById,
  getEpisode,
  getEpisodeSlugInfoAndId,
  runMigrations
} from "./db.ts";
import { fillEpisodesFromHtml, fillSeasonalFromHtml, getCsrfTokenFromHtml, getCurrentSeason, getEpisodeLinkFromId, storeEpisodesFromHtml } from "./helper.ts";
import { KV_COOKIE_EXPIRATION, KV_CSRF_EXPIRATION, KV_EPISODE_LINK_EXPIRATION, SITE, WWW_SITE } from "./config.ts";

if (typeof Deno.cron == "function") {
  Deno.cron("update episodes", "30 */6 * * *", async () => {
    // same as the /updated endpoint
    console.log("Running cron job to update episodes");
    const response = await fetch(`${SITE}/updated`);
    if (!response.ok) {
      console.error("Failed to fetch the /updated endpoint");
      return;
    }
    const html = await response.text();
    // get all episodes from the html
    await storeEpisodesFromHtml(html);
    console.log("Episodes updated successfully from cron job");
  });

  Deno.cron("update seasonal", "10 1 1 * *", async () => {
    // same as the /seasonal endpoint
    console.log("Running cron job to update seasonal data");
    const season = getCurrentSeason();
    const year = new Date().getFullYear();
    const response = await fetch(`${SITE}/upcoming/${year}/${season}`);
    if (!response.ok) {
      console.error("Failed to fetch the /seasonal endpoint");
      return;
    }
    const html = await response.text();
    // process the seasonal data from the html
    await fillSeasonalFromHtml(html, year, season);
    console.log("Seasonal data updated successfully from cron job");
  });
}

const app = new Hono();

// Add CORS middleware
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

app.get("/test", async (c) => {
  return c.text("Test endpoint");
});

app.get("/migrate", async (c) => {
  try {
    await runMigrations();
    return c.text("Migrations completed successfully");
  } catch (error) {
    console.error("Migration error:", error);
    return c.text("Migration failed", 500);
  }
});

app.get("/updated", async (c) => {
  // try fetching
  const response = await fetch(`${SITE}/updated`);
  if (!response.ok) {
    return c.text("Failed to fetch the site", 500);
  }
  const html = await response.text();
  // get all episodes from the html
  await storeEpisodesFromHtml(html);
  return c.text("Episodes updated successfully");
});

app.get("/url/:anime/:episode", async (c) => {
  const animeId = c.req.param("anime");
  const episodeNumber = c.req.param("episode");
  if (!animeId || !episodeNumber) {
    return c.text("Anime ID and episode number are required", 400);
  }

  const kv = await Deno.openKv();

  // get the anime slug and episode slug from the database
  const slugs = await getEpisodeSlugInfoAndId(animeId, episodeNumber);
  let anime = null as any | null;
  if (!slugs) {
    // return c.text("Anime or episode not found", 404);
    // check if the anime exists
    anime = await getAnimeById(animeId);
    if (!anime) {
      return c.text("Anime not found", 404);
    }
  }

  const animeSlug = slugs ? slugs.anime_slug : anime.slug;
  let episodeSlug = slugs ? slugs.episode_slug : null;

  let episodeId: number | null = slugs ? slugs.episode_id : null;

  if (episodeId) {
    let cachedLink = await kv.get(["cache", "episode_link", animeSlug, episodeSlug]);
    if (cachedLink && cachedLink.value) {
      return c.json(cachedLink.value);
    }
  }

  let kvCsrfToken = await kv.get(["cache", "csrf_token"]);
  let kvCookie = await kv.get(["cache", "cookie"]);
  let csrfToken =  kvCsrfToken ? kvCsrfToken.value : null;
  let cookie = kvCookie ? kvCookie.value : null;

  if (!episodeId || !csrfToken || !cookie) {
    // construct the URL
    const url = `${SITE}/play/${animeSlug}/${episodeSlug}`;

    // fetch the page
    const response = await fetch(url);
    if (!response.ok) {
      return c.text("Failed to fetch the episode page", 500);
    }
    // get the headers with the set-cookie
    const headers = response.headers;
    cookie = headers.get("set-cookie");
    if (!cookie) {
      return c.text("No cookie found in the response", 500);
    }
    // save the cookie to kv
    await kv.set(["cache", "cookie"], cookie, { expireIn: KV_COOKIE_EXPIRATION });

    const html = await response.text();

    csrfToken = await getCsrfTokenFromHtml(html);
    if (!csrfToken) {
      return c.text("CSRF token not found", 500);
    }
    // save the csrf token to kv
    await kv.set(["cache", "csrf_token"], csrfToken, { expireIn: KV_CSRF_EXPIRATION });

    await fillEpisodesFromHtml(html, animeId);
    console.log("Episodes filled successfully");

    // retrieve the episode ID from anime id and episode number
    const episode = await getEpisode(animeId, episodeNumber);
    console.log("Episode retrieved:", episode);
    episodeId = episode ? episode.id : null;
    episodeSlug = episode ? episode.slug : null;
    if (!episodeId || !episodeSlug) {
      return c.text("Episode not found", 404);
    }
  }

  const link = await getEpisodeLinkFromId(episodeId, csrfToken, cookie);
  if (!link) {
    return c.text("Failed to retrieve episode link", 500);
  }

  // cache the link in kv
  await kv.set(["cache", "episode_link", animeSlug, episodeSlug], link, { expireIn: KV_EPISODE_LINK_EXPIRATION });

  return c.json(link);
});

Deno.serve(app.fetch);