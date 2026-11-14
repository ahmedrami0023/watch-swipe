// The learning part: orders the titles you haven't rated, using the ones you have.
// Pure functions over the catalogue, no dependencies, nothing random: the same ratings always give the same deck.
//
// How it scores a title (the numbers in TUNING are starting points checked with scripts/sim-learn.mjs, not laws):
//   score = ( 0.35 + unknown x (0.8 + a x 0.5) ) x fame + a x ( match x 0.5 + links x 0.5 + habits x 4 )
//   fame    = 1 for the best-known title, down to 0 for the least known
//   unknown = how little you have rated of its kind, decade, genres and their mixes (1 / sqrt(ratings + 1) each;
//             ground with under 25 titles, like the three documentaries, does not count).
//             So the deck looks around first: well-known titles from ground you haven't rated yet come up early.
//             It shrinks as you rate that ground but never reaches 0, so the deck keeps checking other corners.
//   match   = how you rated other titles sharing its people and themes        (specific taste)
//   links   = "fans of titles you rated also like this", from TMDB            (other people's taste)
//   habits  = how you tend to rate its kind, decade, genres, those mixed (e.g. "anime from the 2020s"), fame and score.
//             A habit you like pulls less right after a run of it (and so do the fans-also-like links),
//             so one taste doesn't crowd out your others.
// a grows slowly from 0 toward 1 as you rate more (a = n² / (n² + 20²): 0.02 after 3 ratings, 0.36 after 15, 0.69 after 30),
// so the first ratings can't send the deck off in one direction: it gets a broad idea of your taste, then narrows step by step.
// In the simulation the broad habits do most of the work; people and themes mainly help when your taste follows
// particular directors or actors, and they are what the "Also by ..." reasons come from.
import { CARDS } from "./cards.js";

// Exported so the simulation can switch parts off and show what each one is worth. The app never changes them.
export const TUNING = { fame: 0.35, ramp: 20, match: 0.5, links: 0.5, habits: 4, probeEvery: 6, curious: 0.8, hope: 0.5, tire: 0.25 };

const N = CARDS.length;
const WEIGHT = { liked: 1, want: 0.8, disliked: -0.8, pass: -0.4, unsure: 0 }; // unsure teaches nothing
const FAV = 2; // a favourite counts double
const BLOCKS = "pkc"; // director/creator, keyword (theme), cast. Genres are a broad habit, below.
const BLOCK = [1.5, 0.3, 0.6]; // how much each of those counts. Themes are noisy, so they count least.
const SHRINK = 3; // a habit needs a few ratings behind it before it counts fully
const SHRINK_SPECIFIC = 1; // a person or theme counts after fewer ratings: liking two films by one director is already a signal
const SHAPED = 30; // only the next 30 cards get variety rules and reasons; the rest is plain score order

export const kindOf = (card) => (card.type.startsWith("Anime") ? "anime" : card.type === "Movie" ? "movie" : "tv");
export const decadeOf = (year) => (year >= 2020 ? "2020s" : year >= 2010 ? "2010s" : year >= 2000 ? "2000s" : year >= 1990 ? "1990s" : "Older");
const halves = (card) => card.genres.flatMap((g) => g.split(" & "));

// ---- computed once, when the app loads ----
// Specific features: people and themes. Rarer ones count for more; ones only a single title has are useless.
const featuresOf = (c) => [...(c.by?.names ?? []).map((n) => `p:${n}`), ...(c.kw ?? []).map((id) => `k:${id}`), ...c.cast.map((n) => `c:${n}`)];
const lists = CARDS.map((c) => [...new Set(featuresOf(c))]);
const seenIn = new Map();
for (const list of lists) for (const f of list) seenIn.set(f, (seenIn.get(f) ?? 0) + 1);
const NAMES = [...seenIn.keys()].filter((f) => seenIn.get(f) >= 2);
const featureId = new Map(NAMES.map((f, id) => [f, id]));
const F = NAMES.length;

// Each title as a short list of (feature, which block it is in, how rare it is). Stored flat for speed.
const START = new Int32Array(N + 1);
const fids = [];
const blocks = [];
const rarity = [];
lists.forEach((list, i) => {
  for (const f of list) {
    if (!featureId.has(f)) continue;
    fids.push(featureId.get(f));
    blocks.push(BLOCKS.indexOf(f[0]));
    rarity.push(Math.log(N / seenIn.get(f)));
  }
  START[i + 1] = fids.length;
});
const FID = Int32Array.from(fids);
const BLK = Uint8Array.from(blocks);
const RARE = Float32Array.from(rarity);

// Broad habits: seven groups per title. Fame and score are in bands so "likes the hits" or "only the acclaimed" can be learned.
// Kind mixed with decade and with genre lets "new anime and old films" be learned, which kind and decade alone can't say.
const band = (value, cuts) => cuts.findIndex((cut) => value < cut);
const habitId = new Map();
const habitName = [];
const habit = (key) => habitId.get(key) ?? (habitName.push(key), habitId.set(key, habitName.length - 1).get(key));
const HABIT = CARDS.map((c, i) => [
  [habit(`kind:${kindOf(c)}`)],
  [habit(`decade:${decadeOf(c.year)}`)],
  halves(c).map((g) => habit(`genre:${g}`)),
  [habit(`kd:${kindOf(c)} ${decadeOf(c.year)}`)],
  halves(c).map((g) => habit(`kg:${kindOf(c)} ${g}`)),
  [habit(`fame:${band(i / N, [0.1, 0.25, 0.5, 0.75, 2])}`)],
  [habit(`score:${band(-(c.rating ?? 0), [-8, -7.5, -7, -6.5, 1])}`)],
]);
const H = habitName.length;
// Ground too small to be worth looking around in (under 25 titles, e.g. the three documentaries) gives no curiosity lift.
const ROOM = new Float32Array(H);
for (const groups of HABIT) for (const group of groups) for (const h of group) ROOM[h]++;
ROOM.forEach((size, h) => (ROOM[h] = size >= 25 ? 1 : 0));
const PREFIXES = ["kind:", "decade:", "genre:", "kd:", "kg:", "fame:", "score:"];
// The groups that count as "ground to look around in". Not the fame and score bands: looking around must not mean obscure titles.
const GROUND = PREFIXES.map((prefix) => !["fame:", "score:"].includes(prefix));
// The habits of each group, e.g. every kind, every decade. Used to see which groups actually divide your ratings.
const GROUPS = PREFIXES.map((prefix) => habitName.map((name, h) => (name.startsWith(prefix) ? h : -1)).filter((h) => h >= 0));

const INDEX = new Map(CARDS.map((c, i) => [c.id, i]));
const KIND = CARDS.map(kindOf);
const DIRECTOR = CARDS.map((c) => c.by?.names[0] ?? null);
const FRANCHISE = CARDS.map((c) => c.col ?? null);
// "Fans of A also like B" (from TMDB), treated as a two-way link.
const NEAR = CARDS.map(() => new Set());
CARDS.forEach((c, i) => {
  for (const id of c.recs ?? []) {
    const j = INDEX.get(id);
    if (j === undefined || j === i) continue;
    NEAR[i].add(j);
    NEAR[j].add(i);
  }
});

const scratch = new Float32Array(F); // one title spread out by feature, reused
const HABIT_WORDS = { "kind:anime": "More anime", "kind:tv": "More TV", "kind:movie": "Another movie", "decade:Older": "An older one" };
const habitWords = (key) => HABIT_WORDS[key] ?? (key.startsWith("decade:") ? `From the ${key.slice(7)}` : key.slice(6));

// ---- the ranking ----
// swipes: [{id, rating, fav?}]. pool: the cards allowed in the deck (filters already applied).
// pinned: ids already on screen; they are left out of the result but count toward the variety rules.
// fromOf: for a card already shown, the id of the rated title its reason pointed at (or null), so one title is not cited too often.
// Returns [{ id, why, from }]: why is a one-line reason or null, from is the rated title it points at (if any).
export function rank(swipes, pool, pinned = [], fromOf = () => null) {
  const weightOf = new Map(); // title index -> how strongly it was rated
  const ratingOf = new Map();
  const habitSum = new Float32Array(H);
  const habitCount = new Float32Array(H);
  const featureSum = new Float32Array(F); // per person/theme: how you rated the titles that have it
  const featureCount = new Float32Array(F);
  let n = 0;
  let total = 0;
  for (const s of swipes) {
    const i = INDEX.get(s.id);
    if (i === undefined) continue;
    const loved = s.fav === true && s.rating === "liked"; // a favourite is always something you liked
    ratingOf.set(i, loved ? "fav" : s.rating);
    if (s.rating === "unsure") continue;
    n++;
    const w = loved ? FAV : (WEIGHT[s.rating] ?? 0);
    total += w;
    weightOf.set(i, w);
    for (let k = START[i]; k < START[i + 1]; k++) {
      featureSum[FID[k]] += w;
      featureCount[FID[k]]++;
    }
    for (const group of HABIT[i])
      for (const h of group) {
        habitSum[h] += w;
        habitCount[h]++;
      }
  }
  // What you were just shown (the last 10 you rated, plus the cards on screen), counted per habit.
  const recent = new Float32Array(H);
  const shown = new Set();
  for (const id of [...swipes.slice(-10).map((s) => s.id), ...pinned]) {
    shown.add(INDEX.get(id));
    for (const group of HABIT[INDEX.get(id)] ?? []) for (const h of group) recent[h]++;
  }
  const a = n * n / (n * n + TUNING.ramp * TUNING.ramp);
  const usual = n ? total / n : 0; // how you tend to rate anything at all
  // How much better or worse than your usual you rate titles with this habit. Few ratings behind it = pulled toward "no difference".
  const edge = (h) => (habitSum[h] - habitCount[h] * usual) / (habitCount[h] + SHRINK);
  // If you like most of what you see, one more like says little. A pass or dislike never counts in a title's favour, though.
  const base = Math.max(0, usual);
  // How much each group matters for you: if you rate anime and movies very differently, kind matters a lot;
  // if every decade gets the same ratings from you, decade matters little.
  const matters = GROUPS.map((ids) => {
    let spread = 0;
    let count = 0;
    for (const h of ids) {
      if (!habitCount[h]) continue;
      spread += habitCount[h] * edge(h) ** 2;
      count += habitCount[h];
    }
    return count ? Math.sqrt(spread / count) : 0;
  });
  const mattersTotal = matters.reduce((sum, m) => sum + m, 0) + 1e-6;

  // Your specific taste: for each person or theme, your average rating of the titles that have it (shrunk when few).
  // It is an average, not a running total, so one favourite director still stands out after hundreds of ratings.
  const taste = new Float32Array(F);
  for (let f = 0; f < F; f++) if (featureCount[f]) taste[f] = (featureSum[f] - featureCount[f] * base) / (featureCount[f] + SHRINK_SPECIFIC);

  const skip = new Set(pinned.map((id) => INDEX.get(id)));
  const blockSum = [0, 0, 0];
  const known = [0, 0, 0];
  const rows = [];
  for (const card of pool) {
    const i = INDEX.get(card.id);
    if (i === undefined || ratingOf.has(i) || skip.has(i)) continue;
    // Per block: the average of your taste for this title's people (or themes, or cast) that you have ratings for.
    // People and themes you have never rated say nothing either way.
    blockSum.fill(0);
    known.fill(0);
    for (let k = START[i]; k < START[i + 1]; k++) {
      if (!featureCount[FID[k]]) continue;
      blockSum[BLK[k]] += taste[FID[k]] * RARE[k];
      known[BLK[k]] += RARE[k];
    }
    let match = 0;
    for (let b = 0; b < 3; b++) if (known[b]) match += (BLOCK[b] * blockSum[b]) / known[b];
    let linked = 0;
    let justShown = 0;
    for (const j of NEAR[i]) {
      if (weightOf.has(j)) linked += weightOf.get(j) - base;
      if (shown.has(j)) justShown++;
    }
    // What you like pulls less right after a run of it, so your other tastes still get turns. Dislikes don't wear off.
    const tired = (pull, run) => (pull > 0 ? pull / (1 + run * TUNING.tire) : pull);
    let habits = 0; // what your habits say about this title
    let pull = 0; // the same, after tiring: this is what goes into the score
    let unknown = 0; // how little you have rated of this title's kind, decade, genres and their mixes
    HABIT[i].forEach((group, g) => {
      if (!group.length) return;
      let sum = 0;
      let sumTired = 0;
      let unrated = 0;
      for (const h of group) {
        sum += edge(h);
        sumTired += tired(edge(h), recent[h]);
        unrated += ROOM[h] / Math.sqrt(habitCount[h] + 1);
      }
      habits += (matters[g] * sum) / group.length;
      pull += (matters[g] * sumTired) / group.length;
      if (GROUND[g]) unknown += unrated / group.length;
    });
    const clamp = (value) => Math.max(-1, Math.min(1, value / mattersTotal));
    // Looking around: well-known titles from ground you haven't rated get a lift. The lift grows a little as your taste
    // takes over (a), so it is never fully drowned out, and it is always scaled by fame, so it never digs up obscure titles.
    const explore = (TUNING.fame + (TUNING.curious + a * TUNING.hope) * unknown) * (1 - i / N);
    const specific = a * (TUNING.match * match + TUNING.links * (tired(Math.max(-3, Math.min(3, linked)), justShown) / 3));
    const broad = a * TUNING.habits * clamp(habits); // used for the reason line and for "is this a personal pick"
    rows.push({ i, specific, broad, explore, score: explore + specific + a * TUNING.habits * clamp(pull) });
  }
  rows.sort((x, y) => y.score - x.score || x.i - y.i);

  // What best explains this pick, using exactly the terms that scored it. Null when nothing personal drove it.
  const explain = (row) => {
    if (n < 3 || row.specific + row.broad < 0.12) return null;
    const i = row.i;

    // The rated title that pushed this one up the most.
    // This title's features, each already divided the way the taste average divides them.
    known.fill(0);
    for (let k = START[i]; k < START[i + 1]; k++) if (featureCount[FID[k]]) known[BLK[k]] += RARE[k];
    for (let k = START[i]; k < START[i + 1]; k++)
      if (featureCount[FID[k]]) scratch[FID[k]] = (BLOCK[BLK[k]] * RARE[k]) / known[BLK[k]] / (featureCount[FID[k]] + SHRINK_SPECIFIC);
    let best = 0;
    let source = -1;
    let person = null;
    for (const [r, w] of weightOf) {
      if (w <= 0) continue; // reasons only ever point at something you liked or want
      let shared = 0;
      let top = 0;
      let topFeature = -1;
      for (let k = START[r]; k < START[r + 1]; k++) {
        const part = scratch[FID[k]];
        shared += part;
        if (part > top) {
          top = part;
          topFeature = FID[k];
        }
      }
      const gave = a * (w - base) * (TUNING.match * shared + (NEAR[i].has(r) ? TUNING.links / 3 : 0));
      if (gave > best) {
        best = gave;
        source = r;
        const name = topFeature >= 0 && top > shared / 2 ? NAMES[topFeature] : "";
        person = name.startsWith("p:") || name.startsWith("c:") ? name : null; // one shared person explains most of it
      }
    }
    for (let k = START[i]; k < START[i + 1]; k++) scratch[FID[k]] = 0;

    // The broad habit that stands out: a kind, decade or genre you rate clearly better than your usual, with 5+ ratings behind it.
    // Naming it again straight after a card of the same habit says nothing new, so then it is left out.
    const last = HABIT[before.at(-1)?.i]?.flat() ?? [];
    let clear = 0.25;
    let key = null;
    for (const group of HABIT[i].slice(0, 3))
      for (const h of group)
        if (habitCount[h] >= 5 && habitSum[h] > 0 && edge(h) > clear && !last.includes(h)) {
          clear = edge(h);
          key = habitName[h];
        }

    const titleLine = () => {
      const title = CARDS[source].title;
      const how = ratingOf.get(source);
      const why = person
        ? `${person.startsWith("p:") ? "Also by" : "With"} ${person.slice(2)}, like ${title}`
        : how === "fav"
          ? `Because you loved ${title}`
          : how === "liked"
            ? `Because you liked ${title}`
            : `Like ${title}, on your watchlist`;
      return { why, from: source };
    };
    const habitLine = () => ({ why: `${habitWords(key)}, which you tend to like`, from: -1 });
    const strongTitle = source >= 0 && best >= 0.04; // a title has to have really mattered to be named
    if (key && row.broad > row.specific) return habitLine();
    if (strongTitle) return titleLine();
    return key ? habitLine() : null;
  };

  // Variety rules, checked against the cards just before this one: the last ones you rated, then the ones on screen.
  const before = [...swipes.slice(-10).map((s) => s.id), ...pinned].map((id) => ({ i: INDEX.get(id), from: INDEX.get(fromOf(id)) ?? -1 })).filter((p) => p.i !== undefined);
  const oneKind = new Set(rows.map((r) => KIND[r.i])).size < 2;
  // strict = all three rules. Not strict = only the two that matter most (director, franchise), for when the
  // best 60 candidates are all the same kind and something has to give.
  const fits = (row, strict = true) => {
    const i = row.i;
    const last = (count) => before.slice(-count);
    if (DIRECTOR[i] && last(6).some((p) => DIRECTOR[p.i] === DIRECTOR[i])) return false; // one per director in 6
    if (FRANCHISE[i] !== null && last(10).some((p) => FRANCHISE[p.i] === FRANCHISE[i])) return false; // one per franchise in 10
    if (!strict) return true;
    return oneKind || before.length < 5 || !last(5).every((p) => KIND[p.i] === KIND[i]); // after 5 of a kind, prefer another kind if a good one exists
  };

  const out = [];
  const used = new Set();
  const shownSoFar = swipes.length + pinned.length;
  const place = (row, why) => {
    used.add(row);
    let reason = why ? null : explain(row);
    // One title is the stated reason at most twice in 6 cards: the card stays where it is, the line is left off.
    if (reason && reason.from >= 0 && before.slice(-6).filter((p) => p.from === reason.from).length >= 2) reason = null;
    before.push({ i: row.i, from: reason?.from ?? -1 });
    out.push({ id: CARDS[row.i].id, why: why ?? reason?.why ?? null, from: reason && reason.from >= 0 ? CARDS[reason.from].id : null });
  };
  for (let slot = 0; slot < SHAPED && used.size < rows.length; slot++) {
    // Counted over every card you have been shown, not per re-ranking, so the turn really comes round.
    if (a >= 0.2 && (shownSoFar + slot) % TUNING.probeEvery === TUNING.probeEvery - 1) {
      // A well-known title (from the best-known quarter) from the ground you have rated least: not already a personal pick,
      // not already ruled out. If there is none, the turn is skipped.
      // Rating it teaches the most, and it keeps the deck from closing in on one corner.
      let probe = null;
      for (const row of rows) {
        const personal = row.specific + row.broad;
        if (used.has(row) || row.i > N / 4 || personal >= 0.12 || personal <= -0.1 || !fits(row)) continue;
        if (!probe || row.explore > probe.explore) probe = row;
      }
      if (probe) {
        place(probe, "Something different, to learn your taste");
        continue;
      }
    }
    let pick = null;
    let nearly = null;
    let first = null;
    let looked = 0;
    for (const row of rows) {
      if (used.has(row)) continue;
      first ??= row;
      if (fits(row)) {
        pick = row;
        break;
      }
      if (!nearly && fits(row, false)) nearly = row;
      if (++looked >= 60) break;
    }
    place(pick ?? nearly ?? first);
  }
  for (const row of rows) if (!used.has(row)) out.push({ id: CARDS[row.i].id, why: null, from: null });
  return out;
}
