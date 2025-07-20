import { addAnimeToRelation, createNewRelation, getRelatedAnimeId, saveAnime, saveEpisode, saveSeasonal } from "./db.ts";
import { DOMParser } from "jsr:@b-fuze/deno-dom";
import { WWW_SITE } from "./config.ts";

export async function storeEpisodesFromHtml(html: string) {

    const document = new DOMParser().parseFromString(html, "text/html");
    if (!document) {
        console.error("Failed to parse HTML");
        return;
    }

    // Select all items in the film list
    const items = document.querySelectorAll('.film-list .item');

    // Extract data from each item
    const extractedData: Array<{
        id: number;
        img: string | null;
        name: string | null;
        number: number;
        anime_slug: string;
        episode_slug: string;
        dubbed: boolean;
    }> = [];

    items.forEach(item => {
        const posterLink = item.querySelector('.poster');
        const nameLink = item.querySelector('.name');
        const image = item.querySelector('.poster img');
        const ep = item.querySelector('.ep');
        const dub = item.querySelector('.dub');

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
        // split href in anime slug and episode slug
        // e.g., "/play/maebashi-witches.HjdLI/hqq831" becomes ["maebashi-witches.HjdLI", "hqq831"]
        const hrefParts = href ? href.split('/') : [];
        // if hrefParts has less than 2 parts, we can't extract the anime slug and episode slug
        if (hrefParts.length < 2) {
            console.warn("Invalid href format:", href);
            return;
        }
        const animeSlug = hrefParts[hrefParts.length - 2]; // e.g., "maebashi-witches.HjdLI"
        const episodeSlug = hrefParts[hrefParts.length - 1]; // e.g., "hqq831"
        // grab the last part of the data-tip, which is the id (e.g., "api/tooltip/12345")
        const id = dataTip ? parseInt(dataTip.split('/').pop(), 10) : null;
        const img = image ? image.getAttribute('src') : null;
        const name = nameLink && nameLink.textContent ? nameLink.textContent.trim() : null;

        if (id === null || isNaN(id)) {
            console.warn("No valid ID found for item:", item);
            return;
        }
        if (number === null || isNaN(number)) {
            console.warn("No valid episode number found for item:", item);
            return;
        }

        const itemData = {
            id: id,
            img: img,
            name: name,
            number: number,
            anime_slug: animeSlug,
            episode_slug: episodeSlug,
            dubbed: !!dub
        };

        extractedData.push(itemData);
    });

    // console.log(extractedData);

    // save anime and episodes to the database
    for (const data of extractedData) {
        await saveAnime({
            id: data.id,
            slug: data.anime_slug,
            name: data.name,
            image_url: data.img,
            dubbed: data.dubbed,
        });
        await saveEpisode({
            slug: data.episode_slug,
            episode_number: data.number,
            anime_id: data.id,
        });
    }
    console.log("Episodes extracted successfully");
}

// fill episodes id
export async function fillEpisodesFromHtml(html: string, animeId: number) {
    const document = new DOMParser().parseFromString(html, "text/html");
    if (!document) {
        console.error("Failed to parse HTML");
        return;
    }

    // Select all items in the film list
    const items = document.querySelectorAll('.server.active .episode');

    console.log(`Found ${items.length} episodes to process`);
    const episodeData: Array<{
        episode_slug: string;
        episode_id: number;
        episode_number: number;
    }> = [];

    items.forEach(item => {
        const episodeLink = item.querySelector('a');
        if (!episodeLink) {
            console.warn("No episode link found for item:", item);
            return;
        }
        const episodeId = episodeLink ? episodeLink.getAttribute('data-episode-id') : null;
        const episodeNumber = episodeLink ? episodeLink.getAttribute('data-episode-num') : null;
        const episodeSlug = episodeLink ? episodeLink.getAttribute('data-id') : null;

        if (!episodeId || !episodeNumber || !episodeSlug) {
            console.warn("Missing episode data for item:", item);
            return;
        }

        episodeData.push({
            episode_slug: episodeSlug,
            episode_id: parseInt(episodeId, 10),
            episode_number: parseInt(episodeNumber, 10),
        });
    });

    console.log(`Extracted ${episodeData.length} episodes`);

    // save episodes to the database
    for (const data of episodeData) {
        await saveEpisode({
            slug: data.episode_slug,
            episode_number: data.episode_number,
            anime_id: animeId,
            episode_id: data.episode_id,
        });
    }
    console.log("Episodes filled successfully");

    // check if anime is related to other animes
    let relatedAnimeId = await getRelatedAnimeId(animeId);
    if (!relatedAnimeId) {
        // create a new related anime entry
        relatedAnimeId = await createNewRelation(animeId);
    }

    if (!relatedAnimeId) {
        console.error("Failed to create or retrieve related anime ID");
        return;
    }

    // fill with the related anime
    const relatedAnimes = document.querySelectorAll('.simple-film-list .related .item');
    const relatedAnimeData: Array<{
        id: number;
        slug: string;
        name: string | null;
        image_url: string | null;
        dubbed: boolean | null;
    }> = [];

    // <div class="item">
    //     <img loading="lazy" src="https://img.animeworld.ac/locandine/Iputw.jpg" class="thumb tooltipstered" alt="Kaiju No. 8 (ITA)" data-tip="api/tooltip/5196">
    //     <div class="info" data-tippy-content="13 Aprile 2024">
    //         <a href="/play/kaiju-no-8-ita.pTJj4" data-jtitle="Kaijuu 8-gou (ITA)" class="name">Kaiju No. 8 (ITA)</a>
    //         <br>
    //         <p>Anime - 2024 - 23 min/ep</p>
    //     </div>
    // </div>

    // id is 5196 (last part of data-tip)
    // slug is kaiju-no-8-ita.pTJj4
    // name is Kaiju No. 8 (ITA)
    // image_url is https://img.animeworld.ac/locandine/Iputw.jpg
    // dubbed is true if the title has (ITA) in the name

    relatedAnimes.forEach(item => {
        const posterLink = item.querySelector('.thumb');
        const nameLink = item.querySelector('.name');
        const image = posterLink ? posterLink.getAttribute('src') : null;
        const dataTip = posterLink ? posterLink.getAttribute('data-tip') : null;

        if (!dataTip) {
            console.warn("No data-tip found for related anime item:", item);
            return;
        }

        const id = parseInt(dataTip.split('/').pop() || '', 10);
        if (isNaN(id)) {
            console.warn("Invalid ID found in data-tip:", dataTip);
            return;
        }

        const slug = nameLink ? nameLink.getAttribute('href')?.split('/').pop() || '' : '';
        const name = nameLink ? nameLink.textContent?.trim() || null : null;
        const dubbed = name ? name.includes('(ITA)') : null; // Check if the name contains (ITA)

        if (!slug || !name) {
            console.warn("Missing slug or name for related anime item:", item);
            return;
        }

        relatedAnimeData.push({
            id: id,
            slug: slug,
            name: name,
            image_url: image,
            dubbed: dubbed,
        });
    });

    // Save related anime data to the database
    for (const data of relatedAnimeData) {
        await saveAnime(data);
        
        // Save the relation to the related anime
        await addAnimeToRelation(relatedAnimeId, data.id);
    }
    console.log("Related anime filled successfully");
}

export async function getCsrfTokenFromHtml(html: string): Promise<string | null> {
    const document = new DOMParser().parseFromString(html, "text/html");
    if (!document) {
        console.error("Failed to parse HTML");
        return null;
    }

    // Find the CSRF token in the meta tag
    const csrfMeta = document.querySelector('meta[name="csrf-token"]');
    if (csrfMeta) {
        return csrfMeta.getAttribute('content') || null;
    }

    console.warn("CSRF token not found in the HTML");
    return null;
}

export async function getEpisodeLinkFromId(episodeId: number, csrfToken: string, cookie: string): Promise<string | null> {
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
        return null;
    }

    const data = await result.json();
    // console.log("Download URL fetched successfully:", data);
    if (data.error) {
        console.error("Error fetching download links:", data.message);
        return null;
    }
    const links = data.links;
    if (!links || Object.keys(links).length === 0) {
        console.error("No download links found");
        return null;
    }
    // get alternative links
    const alternativeLinks = Object.values(links).map(server => {
        // Assert server is an object
        const serverObj = server as Record<string, any>;
        return Object.values(serverObj)[0]?.alternativeLink;
    }).filter(link => link);
    // console.log("Alternative links found:", alternativeLinks.length, "links:", alternativeLinks);

    return alternativeLinks.length > 0 ? alternativeLinks[0] : null;
}

export async function fillSeasonalFromHtml(html: string, year: number, season: string) {
    const document = new DOMParser().parseFromString(html, "text/html");
    if (!document) {
        console.error("Failed to parse HTML");
        return;
    }

    // I only need the anime id
    const items = document.querySelectorAll('.film-listnext .item');
    const seasonalData: Array<{
        anime_id: number;
    }> = [];

    items.forEach(item => {
        const posterLink = item.querySelector('.poster');
        const dataTip = posterLink ? posterLink.getAttribute('data-tip') : null;

        if (!dataTip) {
            console.warn("No data-tip found for seasonal item:", item);
            return;
        }

        const id = parseInt(dataTip.split('/').pop() || '', 10);
        if (isNaN(id)) {
            console.warn("Invalid ID found in data-tip:", dataTip);
            return;
        }

        seasonalData.push({
            anime_id: id,
        });
    });

    // Save seasonal data to the database
    for (const data of seasonalData) {
        await saveSeasonal(data.anime_id, year, season);
    }
}

export function getCurrentSeason(): string {
    const date = new Date();
    const month = date.getMonth();

    // Winter (January-March)
    // Spring (April-June)
    // Summer (July-September)
    // Fall (October-December)
    if (month >= 0 && month <= 2) {
        return "winter";
    } else if (month >= 3 && month <= 5) {
        return "spring";
    } else if (month >= 6 && month <= 8) {
        return "summer";
    } else {
        return "fall";
    }
}