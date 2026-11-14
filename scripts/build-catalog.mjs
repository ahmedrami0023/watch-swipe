// Builds src/cards.js from TMDB: a few hundred well-known movies, TV shows and anime.
// The key stays on this computer; the app ships only the finished list, so it needs no key and no server.
// TMDB terms: non-commercial use, attribution shown in the app, and cached data refreshed within 6 months,
// so re-run this every few months.   Run: npm run catalog
import { writeFileSync } from "node:fs";

const TOKEN = process.env.TMDB_TOKEN;
if (!TOKEN) {
  console.error("TMDB_TOKEN is missing. Put it in .env (see .env in the project root) and run: npm run catalog");
  process.exit(1);
}

const API = "https://api.themoviedb.org/3";
const ANIME = "210024"; // TMDB keyword "anime"
const NOT_SHOWS = "10767,10763,10764,10766"; // talk, news, reality, soap
const sinceTwoYears = new Date(Date.now() - 2 * 365 * 864e5).toISOString().slice(0, 10);

// What goes in. "famous" lists are sorted by number of votes (the most widely seen titles first).
const BUCKETS = [
  { group: "movie", media: "movie", pages: 25, params: { sort_by: "vote_count.desc", without_keywords: ANIME } },
  { group: "movie", media: "movie", pages: 4, params: { sort_by: "popularity.desc", "vote_count.gte": 300, "primary_release_date.gte": sinceTwoYears, without_keywords: ANIME } },
  { group: "tv", media: "tv", pages: 15, params: { sort_by: "vote_count.desc", without_keywords: ANIME, without_genres: NOT_SHOWS } },
  { group: "tv", media: "tv", pages: 3, params: { sort_by: "popularity.desc", "vote_count.gte": 150, "first_air_date.gte": sinceTwoYears, without_keywords: ANIME, without_genres: NOT_SHOWS } },
  { group: "anime", media: "tv", pages: 8, params: { sort_by: "vote_count.desc", with_keywords: ANIME, with_genres: "16" } },
  { group: "anime", media: "movie", pages: 3, params: { sort_by: "vote_count.desc", with_keywords: ANIME, with_genres: "16" } },
];

// The 20 hand-picked titles from the old sample deck, so ratings saved against them carry over.
const SAMPLES = [
  ["Inception", 2010, "movie"], ["Breaking Bad", 2008, "tv"], ["Spirited Away", 2001, "movie"], ["The Dark Knight", 2008, "movie"],
  ["Attack on Titan", 2013, "tv"], ["Parasite", 2019, "movie"], ["The Office", 2005, "tv"], ["Death Note", 2006, "tv"],
  ["Interstellar", 2014, "movie"], ["Game of Thrones", 2011, "tv"], ["Your Name.", 2016, "movie"], ["Pulp Fiction", 1994, "movie"],
  ["Stranger Things", 2016, "tv"], ["Fullmetal Alchemist: Brotherhood", 2009, "tv"], ["The Godfather", 1972, "movie"], ["Severance", 2022, "tv"],
  ["Cowboy Bebop", 1998, "tv"], ["Mad Max: Fury Road", 2015, "movie"], ["The Bear", 2022, "tv"], ["Demon Slayer: Kimetsu no Yaiba", 2019, "tv"],
];

async function get(path, params = {}) {
  const url = `${API}${path}?${new URLSearchParams({ language: "en-US", include_adult: "false", ...params })}`;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}`, accept: "application/json" } }).catch(() => ({ ok: false, status: 599 })); // dropped connection
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && attempt < 5) {
      await new Promise((r) => setTimeout(r, 1000 * attempt)); // TMDB asks clients to back off on 429
      continue;
    }
    throw new Error(`${res.status} for ${path}`);
  }
}

// Runs `job` over `items`, a few at a time.
async function pool(items, size, job) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await job(items[i], i);
      }
    }),
  );
  return out;
}

// Shorter spellings only. TV genres stay combined ("Sci-fi & Fantasy") because splitting them would mislabel shows;
// the app's genre filter matches either half.
const GENRE = { "Science Fiction": ["Sci-fi"], "Sci-Fi & Fantasy": ["Sci-fi & Fantasy"], "TV Movie": [] };
const genres = (list) => [...new Set(list.flatMap((g) => GENRE[g.name] ?? [g.name]))];
const duration = (min) => (min ? (min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`) : null);
// One name per service: drop ad tiers and add-on channels, and fold plan names ("Peacock Premium Plus") into the service.
const services = (list = []) => [
  ...new Set(list.map((p) => p.provider_name).filter((n) => !/channel|with ads/i.test(n)).map((n) => n.replace(/ (Premium Plus|Premium|Essential|Standard)$/, ""))),
];

async function build({ media, id, group }, index) {
  const credits = media === "tv" ? "aggregate_credits" : "credits";
  const d = await get(`/${media}/${id}`, { append_to_response: `${credits},watch/providers,external_ids` });
  const date = d.release_date || d.first_air_date || "";
  if (!d.poster_path || !date) return null;
  const anime = group === "anime";
  const us = d["watch/providers"]?.results?.US;
  const by = media === "tv" ? d.created_by?.map((c) => c.name) : d.credits?.crew?.filter((c) => c.job === "Director").map((c) => c.name);
  const facts =
    media === "tv"
      ? [`${d.number_of_seasons} season${d.number_of_seasons === 1 ? "" : "s"}`, `${d.number_of_episodes} episodes`, d.status === "Returning Series" ? "Still running" : d.status]
      : [duration(d.runtime)];
  return {
    id: `${media === "tv" ? "t" : "m"}-${id}`,
    title: d.title || d.name,
    year: Number(date.slice(0, 4)),
    type: anime ? (media === "tv" ? "Anime series" : "Anime film") : media === "tv" ? "TV series" : "Movie",
    genres: genres(d.genres || []).filter((g) => !(anime && g === "Animation")),
    poster: d.poster_path,
    backdrop: d.backdrop_path || null,
    summary: d.overview || null,
    rating: d.vote_count >= 50 ? Math.round(d.vote_average * 10) / 10 : null,
    votes: d.vote_count,
    facts: facts.filter(Boolean),
    by: by?.length ? { label: media === "tv" ? "Created by" : "Directed by", names: by.slice(0, 2) } : null,
    cast: (d[credits]?.cast || []).slice(0, 5).map((c) => c.name),
    providers: services(us?.flatrate),
    watch: us?.link || null, // TMDB's where-to-watch page (data from JustWatch)
    imdb: d.external_ids?.imdb_id || null,
    hue: (index * 47) % 360,
  };
}

// ---- collect ids ----
const picked = new Map(); // "media-id" -> { media, id, group, votes }
for (const b of BUCKETS) {
  for (let page = 1; page <= b.pages; page++) {
    const { results } = await get(`/discover/${b.media}`, { ...b.params, page });
    for (const r of results) {
      const key = `${b.media}-${r.id}`;
      // First bucket to claim a title wins, except that "anime" always wins over a general bucket.
      if (!picked.has(key) || b.group === "anime") picked.set(key, { media: b.media, id: r.id, group: b.group, votes: r.vote_count });
    }
  }
  console.log(`${b.group.padEnd(6)} ${b.media.padEnd(6)} ${b.params.sort_by.padEnd(16)} -> ${picked.size} titles so far`);
}

// Keep every title the app already has. Lists shift between runs, and a dropped title would orphan its rating.
const old = await import("../src/cards.js").then((m) => m.CARDS).catch(() => []);
let kept = 0;
for (const c of old) {
  if (!/^[mt]-\d+$/.test(c.id)) continue; // ids from the old sample deck
  const media = c.id.startsWith("t-") ? "tv" : "movie";
  const key = `${media}-${c.id.slice(2)}`;
  if (picked.has(key)) continue;
  picked.set(key, { media, id: Number(c.id.slice(2)), group: c.type.startsWith("Anime") ? "anime" : media, votes: c.votes });
  kept++;
}
console.log(`kept ${kept} earlier titles that fell off today's lists`);

const legacy = {};
for (const [i, [title, year, media]] of SAMPLES.entries()) {
  const { results } = await get(`/search/${media}`, { query: title, [media === "tv" ? "first_air_date_year" : "primary_release_year"]: year });
  const hit = results[0];
  if (!hit) {
    console.log(`sample not found: ${title}`);
    continue;
  }
  const key = `${media}-${hit.id}`;
  if (!picked.has(key)) picked.set(key, { media, id: hit.id, group: hit.genre_ids?.includes(16) && hit.original_language === "ja" ? "anime" : media, votes: hit.vote_count });
  legacy[`sample-${i + 1}`] = `${media === "tv" ? "t" : "m"}-${hit.id}`;
}

// ---- fetch details ----
const wanted = [...picked.values()];
const built = (await pool(wanted, 8, build)).map((card, i) => card && { card, group: wanted[i].group }).filter(Boolean);

// ---- order the deck: best-known first, mixing movies, shows and anime in proportion ----
const lanes = {};
for (const b of built) (lanes[b.group] ??= []).push(b.card);
for (const lane of Object.values(lanes)) lane.sort((a, b) => b.votes - a.votes);
const taken = Object.fromEntries(Object.keys(lanes).map((g) => [g, 0]));
const cards = [];
while (cards.length < built.length) {
  const group = Object.keys(lanes)
    .filter((g) => taken[g] < lanes[g].length)
    .sort((a, b) => taken[a] / lanes[a].length - taken[b] / lanes[b].length)[0];
  cards.push(lanes[group][taken[group]++]);
}

const today = new Date().toLocaleDateString("en-CA"); // local date as YYYY-MM-DD
writeFileSync(
  new URL("../src/cards.js", import.meta.url),
  `// Generated by scripts/build-catalog.mjs on ${today}. Do not edit by hand; run: npm run catalog
// Data from TMDB (themoviedb.org); where-to-watch data from JustWatch via TMDB. Refresh within 6 months.
export const BUILT = "${today}";
// Ratings saved against the old 20-title sample deck map onto the same titles here.
export const LEGACY_IDS = ${JSON.stringify(legacy)};
export const CARDS = [
${cards.map((c) => JSON.stringify(c)).join(",\n")}
];
`,
);
const count = (g) => lanes[g]?.length ?? 0;
console.log(`wrote ${cards.length} titles: ${count("movie")} movies, ${count("tv")} shows, ${count("anime")} anime; ${Object.keys(legacy).length}/20 sample ids mapped`);
console.log(`with streaming info: ${cards.filter((c) => c.providers.length).length}; without a score: ${cards.filter((c) => c.rating == null).length}; first ten: ${cards.slice(0, 10).map((c) => c.title).join(" | ")}`);
