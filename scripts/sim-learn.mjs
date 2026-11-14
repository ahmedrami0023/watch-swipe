// Does the deck actually learn? Made-up viewers with hidden tastes swipe 60 cards each,
// once with the learning deck and once with the plain best-known-first deck, and we compare.
// Each viewer is run a few times with different random-looking (but fixed) noise, and the results are averaged.
// No network, nothing random.   Run: npm run sim
// To try a setting without editing code:  MATCH=1 HABITS=2 npm run sim   (names are the keys of TUNING)
import { CARDS } from "../src/cards.js";
import { TUNING, decadeOf, kindOf, rank } from "../src/learn.js";

for (const key of Object.keys(TUNING)) {
  const given = process.env[key.toUpperCase()];
  if (given !== undefined) TUNING[key] = Number(given);
}

const N = CARDS.length;
const SWIPES = 60;
const SEEDS = 10;
const BY_ID = new Map(CARDS.map((c) => [c.id, c]));
const genresOf = (c) => c.genres.flatMap((g) => g.split(" & "));
const by = (c, name) => (c.by?.names ?? []).includes(name);

// Same number every time for the same text, spread over 0..1.
function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

// Found from the data, so nothing is hard-coded: the keywords most typical of crime titles,
// and the most prolific directors/creators and actors in the catalogue.
const tally = (cards, pick) => {
  const seen = new Map();
  for (const c of cards) for (const k of pick(c)) seen.set(k, (seen.get(k) ?? 0) + 1);
  return seen;
};
const allKw = tally(CARDS, (c) => c.kw);
const crimeKw = tally(CARDS.filter((c) => genresOf(c).includes("Crime")), (c) => c.kw);
const CRIME_KW = new Set([...crimeKw].filter(([k, n]) => n >= 8 && n / allKw.get(k) > 0.6).map(([k]) => k));
const most = (pick, count) => new Set([...tally(CARDS, pick)].sort((a, b) => b[1] - a[1]).slice(0, count).map(([name]) => name));
// Every other one of the top names, so this viewer's favourites are scattered rather than "the famous ones".
const everyOther = (set) => new Set([...set].filter((_, k) => k % 2 === 0));
const MAKERS = everyOther(most((c) => c.by?.names ?? [], 40));
const ACTORS = everyOther(most((c) => c.cast, 60));

// Hidden tastes. "mainstream" and "snob" depend on things the model sees only in bands (fame, average score);
// "favourite people" depends only on who made or stars in a title: 50 scattered names, so it is not counted as
// "one clear taste", and the best-known deck already suits this viewer about half the time.
const USERS = [
  { name: "Nolan + sci-fi", focused: true, likes: (c) => (by(c, "Christopher Nolan") ? 3 : 0) + (genresOf(c).includes("Sci-fi") ? 1.5 : 0) },
  { name: "anime only", focused: true, likes: (c) => (kindOf(c) === "anime" ? 3 : 0) },
  { name: "comedy, hates horror", likes: (c) => (genresOf(c).includes("Comedy") ? 2 : 0) - (genresOf(c).includes("Horror") ? 3 : 0) },
  { name: "prestige TV drama", likes: (c) => (kindOf(c) === "tv" && genresOf(c).includes("Drama") ? 2 : 0) + (kindOf(c) === "tv" ? 0.5 : 0) + (c.rating >= 8 ? 1 : 0) },
  { name: "2020s only", focused: true, likes: (c) => (decadeOf(c.year) === "2020s" ? 3 : 0) },
  { name: "crime stories", focused: true, likes: (c) => c.kw.filter((k) => CRIME_KW.has(k)).length * 1.2 + (genresOf(c).includes("Crime") ? 1 : 0) },
  { name: "mainstream", likes: (c, i) => 3 * (1 - i / N) },
  { name: "snob (7.8+ only)", likes: (c) => (c.rating >= 7.8 ? 3 : 0) },
  { name: "favourite people", likes: (c) => ((c.by?.names ?? []).some((p) => MAKERS.has(p)) ? 3 : 0) + (c.cast.some((p) => ACTORS.has(p)) ? 2 : 0) },
];

function answers(user, seed) {
  const taste = CARDS.map((c, i) => user.likes(c, i) + 0.6 * hash(`${c.id}/${seed}/noise`));
  const sorted = [...taste].sort((a, b) => b - a);
  const bar = sorted[Math.floor(N * 0.25)]; // the top quarter of the catalogue is "for them"
  const loved = sorted[Math.floor(N * 0.03)];
  const mean = taste.reduce((s, v) => s + v, 0) / N;
  const margin = 0.15 * Math.sqrt(taste.reduce((s, v) => s + (v - mean) ** 2, 0) / N);
  return new Map(
    CARDS.map((c, i) => {
      const seen = hash(`${c.id}/${seed}/seen`) < (1 - i / N) ** 2; // better-known titles are more likely seen
      const t = taste[i];
      const rating = seen ? (t > bar ? "liked" : "disliked") : t > bar ? "want" : t < bar - margin ? "pass" : "unsure";
      return [c.id, { rating, ...(rating === "liked" && t >= loved && { fav: true }) }];
    }),
  );
}
const isHit = (rating) => rating === "liked" || rating === "want";
const rate = (list, from, to) => list.slice(from, to).filter(isHit).length / (to - from);

// One viewer, one seed, 60 swipes. The loop mirrors the app: the card under the top one stays pinned.
function run(user, seed, learning) {
  const truth = answers(user, seed);
  const swipes = [];
  const shown = [];
  const times = [];
  const reasons = new Map();
  let pins = [];
  let dishonest = 0;
  for (let step = 0; step < SWIPES; step++) {
    const rated = new Set(swipes.map((s) => s.id));
    const pool = CARDS.filter((c) => !rated.has(c.id));
    let deck;
    if (learning) {
      const pinned = pins.filter((id) => !rated.has(id));
      const t0 = performance.now();
      const ranked = rank(swipes, pool, pinned, (id) => reasons.get(id)?.from ?? null);
      times.push(performance.now() - t0);
      for (const r of ranked) reasons.set(r.id, r);
      deck = [...pinned, ...ranked.map((r) => r.id)];
      pins = deck.slice(0, 2);
      // Every reason must point at something this viewer liked, loved or wants...
      const positive = new Set(swipes.filter((s) => isHit(s.rating)).map((s) => s.id));
      for (const r of ranked) {
        if (r.from && !positive.has(r.from)) dishonest++;
        // ...and "Also by X" / "With X" must name someone both titles really share.
        const named = r.why?.match(/^(?:Also by|With) (.+), like /)?.[1];
        if (!named) continue;
        const has = (id) => BY_ID.get(id).cast.includes(named) || (BY_ID.get(id).by?.names ?? []).includes(named);
        if (!has(r.id) || !has(r.from)) dishonest++;
      }
    } else deck = pool.map((c) => c.id);
    const id = deck[0];
    shown.push(id);
    swipes.push({ id, ...truth.get(id) });
  }
  const got = swipes.map((s) => s.rating);
  const cards = shown.map((id) => BY_ID.get(id));
  // The variety rules, checked on the cards actually shown.
  let broken = 0;
  let sameReason = 0;
  let kindRun = 1;
  let maxKindRun = 1;
  const lines = { title: 0, person: 0, habit: 0, different: 0, none: 0 };
  cards.forEach((c, k) => {
    if (!learning) return;
    const why = reasons.get(c.id)?.why;
    lines[!why ? "none" : why.startsWith("Something different") ? "different" : /^(Also by|With) /.test(why) ? "person" : why.endsWith("tend to like") ? "habit" : "title"]++;
    const director = c.by?.names[0];
    if (director && cards.slice(Math.max(0, k - 6), k).some((p) => p.by?.names[0] === director)) broken++;
    if (c.col != null && cards.slice(Math.max(0, k - 10), k).some((p) => p.col === c.col)) broken++;
    const from = reasons.get(c.id)?.from;
    if (from && cards.slice(Math.max(0, k - 6), k).filter((p) => reasons.get(p.id)?.from === from).length >= 2) sameReason++;
    kindRun = k && kindOf(c) === kindOf(cards[k - 1]) ? kindRun + 1 : 1;
    maxKindRun = Math.max(maxKindRun, kindRun);
  });
  times.sort((a, b) => a - b);
  return {
    early: rate(got, 0, 10),
    mid: rate(got, 10, 20),
    late: rate(got, 20, SWIPES),
    kinds: new Set(cards.slice(0, 20).map(kindOf)).size,
    maxKindRun,
    lines,
    broken,
    sameReason,
    dishonest,
    ms: times[Math.floor(times.length / 2)] ?? 0,
    order: shown.join(","),
  };
}

// A viewer's result, averaged over the seeds.
function average(user, u, learning) {
  const runs = Array.from({ length: SEEDS }, (_, s) => run(user, `${u}.${s}`, learning));
  const mean = (pick) => runs.reduce((sum, r) => sum + pick(r), 0) / runs.length;
  const total = (pick) => runs.reduce((sum, r) => sum + pick(r), 0);
  return {
    early: mean((r) => r.early),
    mid: mean((r) => r.mid),
    late: mean((r) => r.late),
    kinds: Math.min(...runs.map((r) => r.kinds)),
    maxKindRun: Math.max(...runs.map((r) => r.maxKindRun)),
    lines: Object.fromEntries(Object.keys(runs[0].lines).map((key) => [key, total((r) => r.lines[key])])),
    broken: total((r) => r.broken),
    sameReason: total((r) => r.sameReason),
    dishonest: total((r) => r.dishonest),
    ms: Math.max(...runs.map((r) => r.ms)),
  };
}

const pct = (v) => `${Math.round(v * 100)}%`.padStart(4);
const lateAverage = () => USERS.reduce((sum, user, u) => sum + average(user, u, true).late, 0) / USERS.length;

console.log(`${N} titles, ${SWIPES} swipes each, ${SEEDS} runs per viewer. "Hit" = the viewer liked it or wants to watch it.`);
console.log(`Settings: ${JSON.stringify(TUNING)}\n`);
console.log("viewer                 best-known deck    learning deck (swipes 1-10, 11-20, 21-60)   lift");
const results = USERS.map((user, u) => {
  const base = average(user, u, false);
  const learn = average(user, u, true);
  const lift = learn.late / Math.max(base.late, 0.01);
  console.log(`${user.name.padEnd(22)} ${pct(base.late)} (21-60)       ${pct(learn.early)} ${pct(learn.mid)} ${pct(learn.late)}                          x${lift.toFixed(2)}`);
  return { user, base, learn, lift };
});
const repeatable = run(USERS[0], "0.0", true).order === run(USERS[0], "0.0", true).order;

const mean = (pick) => results.reduce((s, r) => s + pick(r), 0) / results.length;
const sum = (pick) => results.reduce((s, r) => s + pick(r), 0);
const checks = [
  ["Average hit rate on swipes 21-60 is at least 1.3x the best-known deck", mean((r) => r.learn.late) >= 1.3 * mean((r) => r.base.late), `${pct(mean((r) => r.learn.late)).trim()} vs ${pct(mean((r) => r.base.late)).trim()}`],
  // For the "mainstream" viewer the best-known deck is perfect by construction (their taste IS the fame order),
  // so learning can only cost them a little there: the bar is 0.8x for them and 0.95x for everyone else.
  ["No viewer is left clearly worse off than the best-known deck", results.every((r) => r.learn.late >= (r.user.name === "mainstream" ? 0.8 : 0.95) * r.base.late), results.filter((r) => r.learn.late < r.base.late).map((r) => `${r.user.name} x${r.lift.toFixed(2)}`).join(", ") || "none worse"],
  ["Viewers with one clear taste get at least 1.5x the hits by swipes 21-60", results.filter((r) => r.user.focused).every((r) => r.lift >= 1.5), results.filter((r) => r.user.focused).map((r) => `x${r.lift.toFixed(1)}`).join(" ")],
  ["Variety rules hold across the cards shown (director, franchise)", sum((r) => r.learn.broken) === 0, `${sum((r) => r.learn.broken)} breaks`],
  ["No title is cited as the reason more than twice in 6 cards", sum((r) => r.learn.sameReason) === 0, `${sum((r) => r.learn.sameReason)} times`],
  ["First 20 cards include at least two of movies, shows and anime", results.every((r) => r.learn.kinds >= 2), results.map((r) => r.learn.kinds).join(" ")],
  ["Same ratings always give the same deck", repeatable, ""],
  ["Every reason is true (points at a liked or wanted title; named people are really shared)", sum((r) => r.learn.dishonest) === 0, `${sum((r) => r.learn.dishonest)} bad`],
  ["Re-ranking takes under 5 ms (median, this computer)", results.every((r) => r.learn.ms < 5), `${Math.max(...results.map((r) => r.learn.ms)).toFixed(2)} ms worst`],
];
console.log("");
for (const [name, ok, detail] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);

// What each part of the model is worth: switch it off and see how far the average falls.
if (!process.env.QUICK) {
  console.log(`\nWhat each part adds (average hits on swipes 21-60, everything on = ${pct(mean((r) => r.learn.late)).trim()}):`);
  for (const [part, label, off] of [
    ["match", "specific taste (people, themes)", 0],
    ["links", "fans-also-like links", 0],
    ["habits", "broad habits (kind, decade, genre, fame, score)", 0],
    ["probeEvery", 'the "something different" cards', 1e9],
  ]) {
    const saved = TUNING[part];
    TUNING[part] = off;
    console.log(`  without ${label}: ${pct(lateAverage()).trim()}`);
    TUNING[part] = saved;
  }
}
const shownTotal = USERS.length * SEEDS * SWIPES;
const share = (key) => pct(sum((r) => r.learn.lines[key]) / shownTotal).trim();
console.log(`\nReason shown on the card: a title you rated ${share("title")}, a shared person ${share("person")}, a habit ${share("habit")}, "something different" ${share("different")}, none ${share("none")}`);
console.log(`Longest run of one kind in a row: ${Math.max(...results.map((r) => r.learn.maxKindRun))}`);
process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
