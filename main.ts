import { Hono } from "https://deno.land/x/hono@v3.4.1/mod.ts";

import { 
  getEpisodeId,
  getEpisodeSlugInfo,
  runMigrations
} from "./db.ts";
import { fillEpisodesFromHtml, getCsrfTokenFromHtml, storeEpisodesFromHtml } from "./helper.ts";

const app = new Hono();

const SITE = "https://animeworld.ac";
const WWW_SITE = "https://www.animeworld.ac";

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
  // console.log("Response status:", response.status);
  if (!response.ok) {
    return c.text("Failed to fetch the site", 500);
  }
  const html = await response.text();
  // console.log("Fetched HTML successfully");
  // get all episodes from the html
  await storeEpisodesFromHtml(html);
  // console.log("Episodes extracted successfully");
});

app.get("/url/:anime/:episode", async (c) => {
  const animeId = c.req.param("anime");
  const episodeNumber = c.req.param("episode");
  if (!animeId || !episodeNumber) {
    return c.text("Anime ID and episode number are required", 400);
  }

  // get the anime slug and episode slug from the database
  const slugs = await getEpisodeSlugInfo(animeId, episodeNumber);
  if (!slugs) {
    return c.text("Anime or episode not found", 404);
  }

  // { anime_slug: "one-piece-ita.d5nahE", episode_slug: "rdCYSv" }
  const animeSlug = slugs.anime_slug;
  const episodeSlug = slugs.episode_slug;
  
  // construct the URL
  const url = `${SITE}/play/${animeSlug}/${episodeSlug}`;
  // console.log(`Constructed URL: ${url}`);

  // fetch the page
  const response = await fetch(url);
  if (!response.ok) {
    return c.text("Failed to fetch the episode page", 500);
  }
  // get the headers with the set-cookie
  const headers = response.headers;
  const cookie = headers.get("set-cookie");
  if (!cookie) {
    return c.text("No cookie found in the response", 500);
  }
  const html = await response.text();

  const csrfToken = await getCsrfTokenFromHtml(html);
  if (!csrfToken) {
    return c.text("CSRF token not found", 500);
  }

  await fillEpisodesFromHtml(html, animeId);

  // retrieve the episode ID from anime id and episode number
  const episodeId = await getEpisodeId(animeId, episodeNumber);
  if (!episodeId) {
    return c.text("Episode not found", 404);
  }
  // console.log(`Episode ID: ${episodeId}`);

  const result = await fetch(`${WWW_SITE}/api/download/${episodeId}`, {
    "headers": {
      "accept": "application/json, text/javascript, */*; q=0.01",
      "accept-language": "it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7",
      "csrf-token": csrfToken,
      "priority": "u=1, i",
      "sec-ch-ua": "\"Chromium\";v=\"136\", \"Google Chrome\";v=\"136\", \"Not.A/Brand\";v=\"99\"",
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": "\"Linux\"",
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      "x-requested-with": "XMLHttpRequest",
      "cookie": cookie,
      "Referrer-Policy": "unsafe-url"
    },
    "body": null,
    "method": "POST"
  });
  
  if (!result.ok) {
    console.error("Failed to fetch the download URL:", result.statusText);
    return c.text("Failed to fetch the download URL", 500);
  }

  const data = await result.json();
  // console.log("Download URL fetched successfully:", data);
  if (data.error) {
    console.error("Error fetching download links:", data.message);
    return c.text("Error fetching download links", 500);
  }
  const links = data.links;
  if (!links || Object.keys(links).length === 0) {
    console.error("No download links found");
    return c.text("No download links found", 404);
  }
  // get alternative links
  const alternativeLinks = Object.values(links).map(server => {
    // Assert server is an object
    const serverObj = server as Record<string, any>;
    return Object.values(serverObj)[0]?.alternativeLink;
  }).filter(link => link);
  // console.log("Alternative links found:", alternativeLinks.length, "links:", alternativeLinks);

  return c.json(alternativeLinks);
});

Deno.serve(app.fetch);