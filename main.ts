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

app.get("/url/:id", async (c) => {
  const id = c.req.param("id");
  if (!id) {
    return c.text("ID is required", 400);
  }

  const cookie = "sessionId=s%3AXNpMdcqM6Z4NzGFrTUL-gO9moAlO6xuU.Qxzwx2kXFisgD%2FV2wQQykrnhLz8IK0htDadNr3O%2B5YY; expandedPlayer=false";
  const csrfToken = "RQzqFbbm-9xiuhtJi3jpgTDclCt3lWWpussM";

  const result = await fetch("https://www.animeworld.ac/api/download/90655", {
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
      //"Referer": "https://www.animeworld.ac/play/maebashi-witches.HjdLI/hqq831",
      "Referrer-Policy": "unsafe-url"
    },
    "body": null,
    "method": "POST"
  });
  
  console.log("Response status:", await result.text());


});

Deno.serve(app.fetch);