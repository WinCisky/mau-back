import { Hono } from "https://deno.land/x/hono@v3.4.1/mod.ts";

import { 
  runMigrations,
  saveEpisode
} from "./db.ts";
import { storeEpisodesFromHtml } from "./helper.ts";

const app = new Hono();

const SITE = "https://animeworld.ac";

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
  console.log("Response status:", response.status);
  if (!response.ok) {
    return c.text("Failed to fetch the site", 500);
  }
  const html = await response.text();
  console.log("Fetched HTML successfully");
  // get all episodes from the html
  await storeEpisodesFromHtml(html, SITE);
  console.log("Episodes extracted successfully");
});

Deno.serve(app.fetch);