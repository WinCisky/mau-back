import { saveAnime, saveEpisode } from "./db.ts";
import { DOMParser } from "jsr:@b-fuze/deno-dom";

export async function storeEpisodesFromHtml(html: string, site: string) {

    const document = new DOMParser().parseFromString(html, "text/html");
    if (!document) {
        console.error("Failed to parse HTML");
        return;
    }

    // Select all items in the film list
    const items = document.querySelectorAll('.film-list .item');

    // Extract data from each item
    const extractedData: Array<{
        id: number | null;
        link: string | null;
        img: string | null;
        name: string | null;
        number: number | null;
    }> = [];

    items.forEach(item => {
        const posterLink = item.querySelector('.poster');
        const nameLink = item.querySelector('.name');
        const image = item.querySelector('.poster img');
        const ep = item.querySelector('.ep');

        const href = posterLink ? posterLink.getAttribute('href') : null;
        const dataTip = posterLink ? posterLink.getAttribute('data-tip') : null;

        // Try to extract episode number from URL
        let number: number | null = null;
        // trim ep content, divide it by space and take the last part
        if (ep && ep.textContent) {
            const epText = ep.textContent.trim();
            const parts = epText.split(' ');
            const lastPart = parts[parts.length - 1];
            const epNumberMatch = lastPart.match(/(\d+)/);
            if (epNumberMatch && epNumberMatch[1]) {
                number = parseInt(epNumberMatch[1], 10);
            }
        }
        // add domain to href if it has no protocol
        const link = href && !href.startsWith('http') ? `${site}${href}` : href;
        // grab the last part of the data-tip, which is the id (e.g., "api/tooltip/12345")
        const id = dataTip ? parseInt(dataTip.split('/').pop(), 10) : null;
        const img = image ? image.getAttribute('src') : null;
        const name = nameLink && nameLink.textContent ? nameLink.textContent.trim() : null;


        const itemData = {
            id: id,
            link: link,
            img: img,
            name: name,
            number: number
        };

        extractedData.push(itemData);
    });

    // console.log(extractedData);

    // save anime and episodes to the database
    for (const data of extractedData) {
        if (data.id && data.id > 0) {
            await saveAnime({
                id: data.id,
                name: data.name || `Anime ${data.id}`,
                image_url: data.img || "",
            });
            await saveEpisode({
                episode_link: data.link || "",
                video_link: null,
                episode_number: data.number || -1,
                anime_id: data.id,
            });
        } else {
            console.warn("No ID found for item:", data);
        }
    }
    console.log("Episodes extracted successfully");
}