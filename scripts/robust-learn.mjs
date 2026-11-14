// Odd situations the deck has to survive: filters, tiny pools, ratings that did not come from the deck, nothing but "not sure".
// No network, nothing random.   Run: node scripts/robust-learn.mjs
import { CARDS } from "../src/cards.js";
import { decadeOf, kindOf, rank } from "../src/learn.js";

const RANK = new Map(CARDS.map((c, i) => [c.id, i]));
const BY_ID = new Map(CARDS.map((c) => [c.id, c]));
const results = [];
const check = (name, pass, detail = "") => {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};
const attempt = (name, body) => {
  try {
    body();
  } catch (error) {
    check(name, false, `threw: ${error.message}`);
  }
};
// The result must be exactly the cards that are in the pool, not rated and not on screen, each once.
const exact = (swipes, pool, pinned, out) => {
  const rated = new Set(swipes.map((s) => s.id));
  const want = pool.filter((c) => !rated.has(c.id) && !pinned.includes(c.id)).map((c) => c.id).sort();
  return JSON.stringify(out.map((r) => r.id).sort()) === JSON.stringify(want);
};
// Swipe through the deck the way the app does (the card under the top one stays where it is).
function play(pool, answer, steps, swipes = []) {
  swipes = [...swipes];
  const shown = [];
  let pins = [];
  for (let step = 0; step < steps; step++) {
    const rated = new Set(swipes.map((s) => s.id));
    const pinned = pins.filter((id) => !rated.has(id));
    const deck = [...pinned, ...rank(swipes, pool.filter((c) => !rated.has(c.id)), pinned).map((r) => r.id)];
    if (!deck.length) break;
    pins = deck.slice(0, 2);
    shown.push(BY_ID.get(deck[0]));
    swipes.push({ id: deck[0], ...answer(BY_ID.get(deck[0])) });
  }
  return { shown, swipes };
}
const kinds = (cards) => new Set(cards.map(kindOf)).size;
const decades = (cards) => new Set(cards.map((c) => decadeOf(c.year))).size;
const most = (cards, pick) => Math.max(...[...new Set(cards.map(pick))].map((k) => cards.filter((c) => pick(c) === k).length));
const like = () => ({ rating: "liked" });

attempt("Nothing rated yet: every title comes back once, starting with a well-known one", () => {
  const out = rank([], CARDS);
  check("Nothing rated yet: every title comes back once, starting with a well-known one", exact([], CARDS, [], out) && RANK.get(out[0].id) < 30, `first is #${RANK.get(out[0].id) + 1}`);
});
attempt("The deck is always exactly the unrated cards not on screen", () => {
  const states = [5, 20, 45].map((steps) => play(CARDS, (c) => ({ rating: kindOf(c) === "tv" ? "liked" : "pass" }), steps).swipes);
  const good = states.every((swipes) => {
    const pool = CARDS.filter((c) => !swipes.some((s) => s.id === c.id));
    const pinned = [pool[3].id, pool[40].id];
    return exact(swipes, pool, pinned, rank(swipes, pool, pinned));
  });
  check("The deck is always exactly the unrated cards not on screen", good);
});
attempt("Movies-only filter: still a broad start (4+ decades in the first 15), nothing but movies", () => {
  const pool = CARDS.filter((c) => kindOf(c) === "movie");
  const { shown } = play(pool, like, 15);
  check("Movies-only filter: still a broad start (4+ decades in the first 15), nothing but movies", shown.length === 15 && kinds(shown) === 1 && decades(shown) >= 4, `${decades(shown)} decades`);
});
attempt("A pool of 5 titles, and an empty pool", () => {
  const five = CARDS.slice(100, 105);
  const out = rank([{ id: CARDS[0].id, rating: "liked" }], five);
  check("A pool of 5 titles, and an empty pool", exact([], five, [], out) && rank([], []).length === 0 && play(five, like, 9).shown.length === 5);
});
attempt("300 ratings arrive at once (an import) from someone who only likes anime: the deck is mostly anime straight away", () => {
  const swipes = CARDS.filter((_, i) => i % 3 === 0).slice(0, 300).map((c) => ({ id: c.id, rating: kindOf(c) === "anime" ? "liked" : "pass" }));
  const { shown } = play(CARDS, (c) => ({ rating: kindOf(c) === "anime" ? "liked" : "pass" }), 12, swipes);
  const anime = shown.filter((c) => kindOf(c) === "anime").length;
  check("300 ratings arrive at once (an import) from someone who only likes anime: the deck is mostly anime straight away", anime >= 7, `${anime} of 12 anime`);
});
attempt("Three favourites added from Search before any swiping: the deck still starts broad", () => {
  const favs = CARDS.filter((c) => kindOf(c) === "anime").slice(60, 63).map((c) => ({ id: c.id, rating: "liked", fav: true }));
  const { shown } = play(CARDS, (c) => ({ rating: kindOf(c) === "anime" ? "liked" : "pass" }), 12, favs);
  check("Three favourites added from Search before any swiping: the deck still starts broad", kinds(shown) === 3 && most(shown, kindOf) <= 7, `${most(shown, kindOf)} of 12 one kind`);
});
attempt('Nothing but "not sure" for 30 cards: the deck keeps going and stays mixed', () => {
  const { shown } = play(CARDS, () => ({ rating: "unsure" }), 30);
  check('Nothing but "not sure" for 30 cards: the deck keeps going and stays mixed', shown.length === 30 && kinds(shown.slice(15)) === 3);
});
attempt("Someone who dislikes everything shown for 25 cards still gets titles people know", () => {
  const { shown } = play(CARDS, () => ({ rating: "pass" }), 35);
  const ranks = shown.slice(25).map((c) => RANK.get(c.id)).sort((a, b) => a - b);
  check("Someone who dislikes everything shown for 25 cards still gets titles people know", ranks[5] < 300, `middle of cards 26-35 is #${ranks[5] + 1}`);
});
attempt("After the start the deck narrows step by step, not all at once (anime-only viewer)", () => {
  const { shown } = play(CARDS, (c) => ({ rating: kindOf(c) === "anime" ? "liked" : "pass" }), 60);
  const share = (from, to) => shown.slice(from, to).filter((c) => kindOf(c) === "anime").length / (to - from);
  const steps = [share(0, 15), share(15, 30), share(30, 60)];
  check("After the start the deck narrows step by step, not all at once (anime-only viewer)", steps[0] <= 0.55 && steps[1] >= steps[0] && steps[2] >= steps[1] && steps[2] >= 0.6, steps.map((v) => `${Math.round(v * 100)}%`).join(" -> "));
});
attempt("Unknown ids are ignored, and the same ratings always give the same deck", () => {
  const swipes = [{ id: "nope", rating: "liked" }, { id: CARDS[1].id, rating: "liked" }, { id: CARDS[2].id, rating: "pass" }];
  const one = rank(swipes, CARDS, ["also-nope"]).map((r) => r.id).join();
  check("Unknown ids are ignored, and the same ratings always give the same deck", one === rank(swipes, CARDS, ["also-nope"]).map((r) => r.id).join());
});

console.log(`\n${results.filter(Boolean).length} of ${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
