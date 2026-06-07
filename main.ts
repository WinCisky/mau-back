import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  runScheduledTask,
  syncLatestAnimeworldEpisodes,
  json,
  handleLink,
  handleEpisodes,
  handleSyncLatestEpisodes,
  corsHeaders
} from "./helper.ts"

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseAnonKey = Deno.env.get("SUPABASE_KEY");

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_KEY");
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

Deno.cron("scheduled-task", "30 */4 * * *", async () => {
  await runScheduledTask(supabase);
});

Deno.cron("sync-latest-episodes", "0 */6 * * *", async () => {
  await syncLatestAnimeworldEpisodes(supabase);
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return json({ error: "method not allowed" }, 405);
  }

  const url = new URL(req.url);

  try {
    switch (url.pathname) {
      case "/link":
        return await handleLink(supabase, url.searchParams);
      case "/episodes":
        return await handleEpisodes(supabase, url.searchParams);
      case "/sync-latest-episodes":
        return await handleSyncLatestEpisodes(supabase, url.searchParams);
      default:
        return json({ error: "route not found" }, 404);
    }
  } catch (error) {
    console.error(error);
    return json({ error: "internal server error" }, 500);
  }
});