// Builds src/cards.js for the sample deck from three free, key-less sources:
//   TV      -> TVmaze   (sharp poster, summary, cast)        https://www.tvmaze.com/api
//   Anime   -> AniList  (sharp cover, summary, colour)       https://docs.anilist.co
//   Movies  -> Wikipedia page summary (small poster, summary)
// ponytail: this is a stand-in until a TMDB key exists; then one TMDB script replaces all three.
// Run: node scripts/build-sample-deck.mjs
import { writeFileSync } from "node:fs";

const DECK = [
  ["Inception", 2010, "Movie", "wiki", "Inception"],
  ["Breaking Bad", 2008, "TV series", "tvmaze", "Breaking Bad"],
  ["Spirited Away", 2001, "Anime film", "anilist", "Spirited Away"],
  ["The Dark Knight", 2008, "Movie", "wiki", "The Dark Knight"],
  ["Attack on Titan", 2013, "Anime series", "anilist", "Attack on Titan"],
  ["Parasite", 2019, "Movie", "wiki", "Parasite (2019 film)"],
  ["The Office", 2005, "TV series", "tvmaze", "The Office"],
  ["Death Note", 2006, "Anime series", "anilist", "Death Note"],
  ["Interstellar", 2014, "Movie", "wiki", "Interstellar (film)"],
  ["Game of Thrones", 2011, "TV series", "tvmaze", "Game of Thrones"],
  ["Your Name", 2016, "Anime film", "anilist", "Your Name."],
  ["Pulp Fiction", 1994, "Movie", "wiki", "Pulp Fiction"],
  ["Stranger Things", 2016, "TV series", "tvmaze", "Stranger Things"],
  ["Fullmetal Alchemist: Brotherhood", 2009, "Anime series", "anilist", "Fullmetal Alchemist: Brotherhood"],
  ["The Godfather", 1972, "Movie", "wiki", "The Godfather"],
  ["Severance", 2022, "TV series", "tvmaze", "Severance"],
  ["Cowboy Bebop", 1998, "Anime series", "anilist", "Cowboy Bebop"],
  ["Mad Max: Fury Road", 2015, "Movie", "wiki", "Mad Max: Fury Road"],
  ["The Bear", 2022, "TV series", "tvmaze", "The Bear"],
  ["Demon Slayer", 2019, "Anime series", "anilist", "Demon Slayer: Kimetsu no Yaiba"],
];

const UA = { "User-Agent": "sample-deck-build-script/0.1" };
const strip = (html) => (html || "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/\(Source:[^)]*\)/gi, "").replace(/\s+/g, " ").trim();
const norm = (g) => ({ "Science-Fiction": "Sci-fi", "Sci-Fi": "Sci-fi", "Slice of Life": "Slice of life" })[g] ?? g;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = async (url, init) => {
  const r = await fetch(url, { ...init, headers: { ...UA, ...init?.headers } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
};

const sources = {
  async wiki(q) {
    const j = await json("https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(q.replace(/ /g, "_")));
    return {
      image: (j.originalimage?.source || null)?.split("?")[0] ?? null,
      summary: j.extract || null,
      credit: "Wikipedia",
      link: j.content_urls?.desktop?.page || null,
    };
  },
  async tvmaze(q, year) {
    const j = await json(`https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(q)}&embed=cast`);
    if (!String(j.premiered || "").startsWith(String(year))) throw new Error(`year mismatch for ${q}: ${j.premiered}`);
    return {
      image: j.image?.original || null,
      summary: strip(j.summary) || null,
      genres: j.genres?.slice(0, 3),
      cast: [...new Set((j._embedded?.cast || []).map((c) => c.person?.name).filter(Boolean))].slice(0, 5),
      facts: [j.network?.name || j.webChannel?.name, j.averageRuntime && `${j.averageRuntime} min episodes`, j.status].filter(Boolean),
      score: j.rating?.average ? { label: "TVmaze", value: j.rating.average.toFixed(1) } : null,
      credit: "TVmaze",
      link: j.url || null,
    };
  },
  async anilist(q, year, type) {
    const query = `query ($q: String, $f: [MediaFormat]) { Media(search: $q, type: ANIME, format_in: $f, sort: POPULARITY_DESC) {
      title { english romaji } coverImage { extraLarge color } description(asHtml: false) genres averageScore episodes duration
      seasonYear siteUrl studios(isMain: true) { nodes { name } } } }`;
    const variables = { q, f: type === "Anime film" ? ["MOVIE"] : ["TV"] };
    const { data } = await json("https://graphql.anilist.co", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ query, variables }) });
    const m = data.Media;
    if (m.seasonYear !== year) throw new Error(`year mismatch for ${q}: ${m.seasonYear} (${m.title.english || m.title.romaji})`);
    return {
      image: m.coverImage?.extraLarge || null,
      color: m.coverImage?.color || null,
      summary: strip(m.description) || null,
      genres: m.genres?.slice(0, 3),
      facts: [m.studios?.nodes?.[0]?.name, type === "Anime film" ? m.duration && `${m.duration} min` : m.episodes && `${m.episodes} episodes`].filter(Boolean),
      score: m.averageScore ? { label: "AniList", value: `${m.averageScore}%` } : null,
      credit: "AniList",
      link: m.siteUrl || null,
    };
  },
};

const FALLBACK_GENRES = { Inception: ["Sci-fi", "Thriller"], "The Dark Knight": ["Action", "Crime"], Parasite: ["Thriller", "Dark comedy"], Interstellar: ["Sci-fi", "Drama"], "Pulp Fiction": ["Crime", "Dark comedy"], "The Godfather": ["Crime", "Drama"], "Mad Max: Fury Road": ["Action", "Sci-fi"] };

const cards = [];
for (const [i, [title, year, type, source, q]] of DECK.entries()) {
  let d = {};
  try {
    d = await sources[source](q, year, type);
  } catch (e) {
    console.log("FAIL", title, "-", e.message);
  }
  const card = { id: `sample-${i + 1}`, title, year, type, genres: (d.genres?.length ? d.genres : FALLBACK_GENRES[title] || []).map(norm), hue: (i * 47) % 360, image: d.image || null, color: d.color || null, summary: d.summary || null, cast: d.cast?.length ? d.cast : null, facts: d.facts?.length ? d.facts : null, score: d.score || null, credit: d.credit || null, link: d.link || null };
  cards.push(card);
  console.log((card.image ? "img " : "NONE").padEnd(5), source.padEnd(8), title.padEnd(34), card.score ? `${card.score.label} ${card.score.value}` : "-", "|", (card.facts || []).join(", "));
  await sleep(source === "anilist" ? 2200 : 300); // AniList allows 30 requests a minute
}

writeFileSync(
  new URL("../src/cards.js", import.meta.url),
  `// Generated by scripts/build-sample-deck.mjs. Do not edit by hand.
// Sample deck from TVmaze, AniList and Wikipedia (each card names its source in "credit").
export const CARDS = ${JSON.stringify(cards, null, 2)};
`,
);
console.log(`wrote ${cards.length} cards, ${cards.filter((c) => c.image).length} with an image`);
