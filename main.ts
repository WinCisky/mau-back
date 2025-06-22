import { Hono } from "https://deno.land/x/hono@v3.4.1/mod.ts";

import { runMigrations, addTodo, getTodos } from "./db.ts";

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
  const regex = /<div class="item">[\s\S]*?<a href="([^"]*)" class="poster[^"]*" data-tip="api\/tooltip\/(\d+)"[\s\S]*?<img[^>]*src="([^"]*)"[\s\S]*?<div class="ep">\s*Ep\s*(\d+)\s*<\/div>[\s\S]*?<\/div>/g;

  for (const match of html.matchAll(regex)) {
      const [_, link, id, imageUrl, episodeNumber] = match;
      console.log("Found episode:", episodeNumber, "link:", link, "with ID:", id, "image:", imageUrl);
      
      // todo: check if anime already exists, if does not, create a new entry (recover anime data later)

      // todo: save the episode to the database


      return; // todo: remove this return to process all episodes
  }

  console.log("Episodes extracted successfully");

});

Deno.serve(app.fetch);