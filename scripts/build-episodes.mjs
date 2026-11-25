// Builds public/episodes/<id>.json for every show in src/cards.js: seasons, episodes, air dates, TMDB scores
// and whether the show is still running. The app loads one small file when a show's details open.
// It leaves cards.js alone, so the deck order does not change. Episodes that are already scheduled carry their
// dates, so the app works out "next episode" on the day; re-run this to pick up newly announced ones.
// Run: npm run episodes
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { CARDS } from "../src/cards.js";

const TOKEN = process.env.TMDB_TOKEN;
if (!TOKEN) {
  console.error("TMDB_TOKEN is missing. Put it in .env and run: npm run episodes");
  process.exit(1);
}

async function get(path, params = {}) {
  const url = `https://api.themoviedb.org/3${path}?${new URLSearchParams({ language: "en-US", ...params })}`;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}`, accept: "application/json" } }).catch(() => ({ ok: false, status: 599 }));
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && attempt < 5) {
      await new Promise((r) => setTimeout(r, 1000 * attempt));
      continue;
    }
    throw new Error(`${res.status} for ${path}`);
  }
}

const score = (avg, votes) => (votes >= 5 && avg > 0 ? Math.round(avg * 10) / 10 : null); // a handful of votes says nothing

async function build(card) {
  const id = card.id.slice(2);
  const show = await get(`/tv/${id}`);
  const numbers = (show.seasons || []).map((s) => s.season_number).filter((n) => n > 0); // season 0 is specials
  const seasons = [];
  // TMDB returns up to 20 seasons per request.
  for (let i = 0; i < numbers.length; i += 20) {
    const part = await get(`/tv/${id}`, { append_to_response: numbers.slice(i, i + 20).map((n) => `season/${n}`).join(",") });
    for (const n of numbers.slice(i, i + 20)) {
      const s = part[`season/${n}`];
      if (!s) continue;
      const eps = (s.episodes || []).map((e) => [e.episode_number, e.name || null, e.air_date || null, score(e.vote_average, e.vote_count)]);
      const rated = eps.filter((e) => e[3] != null);
      seasons.push({
        n,
        name: s.name && s.name !== `Season ${n}` ? s.name : null,
        date: eps[0]?.[2] || s.air_date || null, // the first episode's date: TMDB's season date can be a day off
        // The season's score is the average of its rated episodes (TMDB's own season score has no vote count to judge it by).
        rating: rated.length ? Math.round((rated.reduce((sum, e) => sum + e[3], 0) / rated.length) * 10) / 10 : null,
        eps, // [number, name, air date, score]
      });
    }
  }
  return { status: show.status || null, seasons };
}

const shows = CARDS.filter((c) => c.id.startsWith("t-"));
const dir = new URL("../public/episodes/", import.meta.url);
const out = new Array(shows.length);
let next = 0;
let failed = 0;
await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (next < shows.length) {
      const i = next++;
      out[i] = await build(shows[i]).catch((err) => {
        failed++;
        console.log(`skipped ${shows[i].title}: ${err.message}`);
        return null;
      });
    }
  }),
);

// Write only once everything is fetched, so a failed run does not leave half a folder.
if (failed > shows.length / 10) {
  console.error(`${failed} of ${shows.length} shows failed; nothing written.`);
  process.exit(1);
}
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const today = new Date().toLocaleDateString("en-CA");
let episodes = 0;
let bytes = 0;
for (const [i, data] of out.entries()) {
  if (!data) continue;
  const text = JSON.stringify({ built: today, ...data });
  writeFileSync(new URL(`${shows[i].id}.json`, dir), text);
  bytes += text.length;
  episodes += data.seasons.reduce((sum, s) => sum + s.eps.length, 0);
}
const by = {};
for (const d of out) if (d) by[d.status] = (by[d.status] || 0) + 1;
console.log(`wrote ${shows.length - failed} shows, ${episodes} episodes, ${Math.round(bytes / 1024)} KB; skipped ${failed}`);
console.log(Object.entries(by).map(([k, v]) => `${k}: ${v}`).join(", "));
