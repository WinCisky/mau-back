import { saveEpisode } from "./db.ts";

export async function storeEpisodesFromHtml(html: string, site: string) {
  const regex = /<div class="item">[\s\S]*?<a href="([^"]*)" class="poster[^"]*" data-tip="api\/tooltip\/(\d+)"[\s\S]*?<img[^>]*src="([^"]*)"[\s\S]*?<div class="ep">\s*Ep\s*(\d+)\s*<\/div>[\s\S]*?<\/div>/g;

  for (const match of html.matchAll(regex)) {
    const [_, link, id, imageUrl, episodeNumber] = match;
    console.log("Found episode:", episodeNumber, "link:", link, "with ID:", id, "image:", imageUrl);
    // save the episode to the database
    await saveEpisode({
      episode_link: link,
      video_link: `${site}/api/episode/${id}`,
      episode_number: parseInt(episodeNumber, 10),
      anime_id: parseInt(id, 10),
    });
  }
  console.log("Episodes extracted successfully");
}