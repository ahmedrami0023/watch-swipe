// Shared rules: the five ratings, saved-data cleaning, and deck filters.
import { Heart, Question, Star, ThumbsDown, X } from "@phosphor-icons/react";
import { CARDS, LEGACY_IDS } from "./cards.js";

export const STORE = "watch-swipe:v2"; // saves the rating, not the gesture
export const FILTER_STORE = "watch-swipe:filters";
export const THRESHOLD = 90; // px of travel that commits a swipe
export const FLICK = 600; // px/s that commits a short, fast swipe
export const DOUBLE_TAP = 320; // ms between two taps that count as a double-tap

// Left/right handle titles you haven't seen (the common case); double-tap is the usual "like".
// solid = the icon weight to use on a filled background (X has no true fill style).
// Each rating keeps one colour (see styles.css), one icon and one direction, so colour is never the only cue.
export const RATINGS = {
  pass: { label: "Not interested", short: "Pass", list: "Passed", swipe: "left", key: "ArrowLeft", Icon: X, solid: "bold" },
  disliked: { label: "Seen it, didn't like it", short: "Disliked", list: "Disliked", swipe: "down", key: "ArrowDown", Icon: ThumbsDown, solid: "fill" },
  liked: { label: "Seen it, liked it", short: "Liked", list: "Liked", swipe: null, key: "l", Icon: Star, solid: "fill" },
  unsure: { label: "Haven't seen it, not sure", short: "Not sure", list: "Not sure", swipe: "up", key: "ArrowUp", Icon: Question, solid: "fill" },
  want: { label: "Want to watch", short: "Want", list: "Want", swipe: "right", key: "ArrowRight", Icon: Heart, solid: "fill" },
};
export const RATING_NAMES = Object.keys(RATINGS);
export const BY_SWIPE = Object.fromEntries(RATING_NAMES.filter((r) => RATINGS[r].swipe).map((r) => [RATINGS[r].swipe, r]));
export const BY_ID = new Map(CARDS.map((c) => [c.id, c]));

// How far (0 to 1) a drag of dx,dy has gone toward committing `dir`. Only the dominant axis counts.
export function progress(dir, dx, dy) {
  const horizontal = Math.abs(dx) > Math.abs(dy);
  if ((dir === "left" || dir === "right") !== horizontal) return 0;
  const pull = dir === "right" ? dx : dir === "left" ? -dx : dir === "down" ? dy : -dy;
  return Math.min(Math.max(pull / THRESHOLD, 0), 1);
}

// Saved or imported swipes are untrusted input: keep only known cards and ratings, one entry per card.
// Ids from the old 20-title sample deck are translated to the same titles in the real catalogue.
export function clean(raw) {
  if (!Array.isArray(raw)) return [];
  const known = new Set(BY_ID.keys());
  return raw
    .filter((s) => s && typeof s === "object" && Object.hasOwn(RATINGS, s.rating))
    .map((s) => ({ id: (Object.hasOwn(LEGACY_IDS, s.id) && LEGACY_IDS[s.id]) || s.id, rating: s.rating, at: Number.isFinite(s.at) ? s.at : 0 }))
    .filter((s) => known.delete(s.id));
}

// TMDB image address at a given width ("w154" thumbnails, "w780" full posters).
export const imageUrl = (path, size) => (path ? `https://image.tmdb.org/t/p/${size}${path}` : null);
export const tmdbPage = (card) => `https://www.themoviedb.org/${card.id.startsWith("t-") ? "tv" : "movie"}/${card.id.slice(2)}`;
export function load() {
  try {
    return clean(JSON.parse(localStorage.getItem(STORE) ?? "[]"));
  } catch {
    return [];
  }
}

// ---- deck filters ----
export const KINDS = { movie: "Movies", tv: "TV", anime: "Anime" };
export const DECADES = ["2020s", "2010s", "2000s", "1990s", "Older"];
// TV genres can be pairs ("Action & Adventure"); each half is its own filter choice.
export const GENRES = [...new Set(CARDS.flatMap((c) => c.genres.flatMap((g) => g.split(" & "))))].sort();
export const SCORES = [6, 7, 8]; // "at least" choices for the TMDB score
// The streaming services that carry the most titles in this catalogue.
const serviceCount = {};
for (const c of CARDS) for (const p of c.providers) serviceCount[p] = (serviceCount[p] || 0) + 1;
export const SERVICES = Object.entries(serviceCount).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name]) => name);
export const NO_FILTERS = { kinds: [], genres: [], decade: null, min: null, services: [] };

export const kindOf = (card) => (card.type.startsWith("Anime") ? "anime" : card.type === "Movie" ? "movie" : "tv");
export const decadeOf = (year) => (year >= 2020 ? "2020s" : year >= 2010 ? "2010s" : year >= 2000 ? "2000s" : year >= 1990 ? "1990s" : "Older");
export const matches = (card, f) =>
  (!f.kinds.length || f.kinds.includes(kindOf(card))) &&
  (!f.genres.length || card.genres.some((g) => g.split(" & ").some((half) => f.genres.includes(half)))) &&
  (!f.decade || decadeOf(card.year) === f.decade) &&
  (!f.min || (card.rating ?? 0) >= f.min) &&
  (!f.services.length || card.providers.some((p) => f.services.includes(p)));
export const filterCount = (f) => f.kinds.length + f.genres.length + f.services.length + (f.decade ? 1 : 0) + (f.min ? 1 : 0);

export function loadFilters() {
  try {
    const f = JSON.parse(localStorage.getItem(FILTER_STORE) ?? "null");
    if (!f || typeof f !== "object") return NO_FILTERS;
    const list = (v) => (Array.isArray(v) ? v : []);
    return {
      kinds: list(f.kinds).filter((k) => Object.hasOwn(KINDS, k)),
      genres: list(f.genres).filter((g) => GENRES.includes(g)),
      decade: DECADES.includes(f.decade) ? f.decade : null,
      min: SCORES.includes(f.min) ? f.min : null,
      services: list(f.services).filter((s) => SERVICES.includes(s)),
    };
  } catch {
    return NO_FILTERS;
  }
}

// ---- colour ----
// The card's own colour before clamping (styles.css turns --raw into a safe --tint).
export const rawTint = (card, sampled) => sampled ?? `oklch(0.62 0.12 ${card.hue})`;

// Average colour of a loaded poster, leaning toward its saturated pixels. Null if the canvas is blocked.
export function sample(img) {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 16;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, 16, 16);
    const { data } = ctx.getImageData(0, 0, 16, 16);
    let r = 0, g = 0, b = 0, total = 0;
    for (let i = 0; i < data.length; i += 4) {
      const weight = 8 + Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]);
      r += data[i] * weight;
      g += data[i + 1] * weight;
      b += data[i + 2] * weight;
      total += weight;
    }
    return `rgb(${Math.round(r / total)} ${Math.round(g / total)} ${Math.round(b / total)})`;
  } catch {
    return null;
  }
}
