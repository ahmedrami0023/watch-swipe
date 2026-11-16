import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "motion/react";
import { Cards, ListBullets, MagnifyingGlass, UserCircle } from "@phosphor-icons/react";
import { CARDS } from "./cards.js";
import Deck from "./Deck.jsx";
import { Lists, Search, You } from "./Pages.jsx";
import { Details, Filters } from "./Sheets.jsx";
import { rank } from "./learn.js";
import { BY_ID, FILTER_STORE, NO_FILTERS, RATINGS, RATING_NAMES, STORE, filterCount, load, loadFilters, loadOrphans, matches, rawTint } from "./ratings.js";

const TABS = [
  { id: "swipe", label: "Swipe", Icon: Cards },
  { id: "lists", label: "Lists", Icon: ListBullets },
  { id: "you", label: "You", Icon: UserCircle },
  { id: "search", label: "Search", Icon: MagnifyingGlass }, // search sits at the trailing end, as on iOS
];

// leaving: the rating the last card left with (drives its exit). back: the swipe Undo just restored (drives its return).
function reducer(state, action) {
  const has = (id) => state.swipes.some((s) => s.id === id);
  const title = (id) => BY_ID.get(id).title;
  switch (action.type) {
    case "rate":
      // Naming the card means a late drag on one that is already flying off is ignored.
      if (!BY_ID.has(action.id) || has(action.id)) return state;
      return {
        swipes: [...state.swipes, { id: action.id, rating: action.rating, at: action.at }],
        leaving: action.rating,
        back: null,
        note: `${title(action.id)}: ${RATINGS[action.rating].label}`,
      };
    case "undo": {
      const last = state.swipes.at(-1);
      if (!last) return state;
      return { swipes: state.swipes.slice(0, -1), leaving: null, back: last, note: `Undid. Back to ${title(last.id)}` };
    }
    case "set": // change a rating from a list
      if (!has(action.id)) return state;
      return {
        // Re-rating to anything but Liked takes the title out of favourites.
        swipes: state.swipes.map((s) => (s.id === action.id ? { id: s.id, rating: action.rating, at: s.at, ...(s.fav && action.rating === "liked" && { fav: true }) } : s)),
        leaving: null,
        back: null,
        note: `${title(action.id)}: ${RATINGS[action.rating].label}`,
      };
    case "fav": {
      const current = state.swipes.find((s) => s.id === action.id);
      if (current) {
        const fav = !current.fav;
        // Favouriting something rated otherwise also marks it Liked.
        const next = fav ? { id: current.id, rating: "liked", at: current.at, fav: true } : { id: current.id, rating: current.rating, at: current.at };
        return { ...state, swipes: state.swipes.map((s) => (s === current ? next : s)), note: `${title(action.id)}: ${fav ? "added to" : "removed from"} favorites` };
      }
      // A favourite you haven't rated yet counts as seen and liked, and leaves the deck like a double-tap.
      if (!BY_ID.has(action.id)) return state;
      return {
        swipes: [...state.swipes, { id: action.id, rating: "liked", at: action.at, fav: true }],
        leaving: "liked",
        back: null,
        note: `${title(action.id)}: favorite. ${RATINGS.liked.label}`,
      };
    }
    case "remove":
      if (!has(action.id)) return state;
      return { swipes: state.swipes.filter((s) => s.id !== action.id), leaving: null, back: null, note: `${title(action.id)} is back in the deck` };
    case "import": {
      const fresh = action.swipes.filter((s) => !has(s.id));
      return { swipes: [...state.swipes, ...fresh], leaving: null, back: null, note: "" }; // the You page announces it
    }
    case "reset":
      return { swipes: [], leaving: null, back: null, note: "" };
    case "settle": // the deck changed for another reason (filters): no rated-style exit, and Undo's card no longer jumps the queue
      return state.leaving || state.back ? { ...state, leaving: null, back: null } : state;
    default:
      return state;
  }
}

// A ring and a few sparks where a double-tap landed.
function Burst({ at, onDone }) {
  return (
    <div className="burst" style={{ left: at.x, top: at.y }} aria-hidden="true">
      <motion.span className="ring" initial={{ scale: 0, opacity: 1 }} animate={{ scale: 2.4, opacity: 0 }} transition={{ duration: 0.36, ease: "easeOut" }} />
      {Array.from({ length: 8 }, (_, i) => {
        const angle = (i / 8) * 2 * Math.PI;
        const reach = 70 + (i % 3) * 18;
        return (
          <motion.span
            key={i}
            className="spark"
            initial={{ x: 0, y: 0, opacity: 1 }}
            animate={{ x: Math.cos(angle) * reach, y: Math.sin(angle) * reach, opacity: 0 }}
            transition={{ duration: 0.4, ease: "easeOut", delay: i * 0.012 }}
            onAnimationComplete={i === 7 ? onDone : undefined}
          />
        );
      })}
    </div>
  );
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, null, () => ({ swipes: load(), leaving: null, back: null, note: "" }));
  const [tab, setTab] = useState("swipe");
  const [filters, setFilters] = useState(loadFilters);
  const [details, setDetails] = useState(null); // id of the title whose details sheet is open
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [tints, setTints] = useState({}); // colours read from posters, by card id
  const [burst, setBurst] = useState(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const reduce = useReducedMotion();
  const orphans = useRef(null); // ratings for titles not in this catalogue: saved back as they were
  if (orphans.current === null) orphans.current = loadOrphans();
  const { swipes } = state;

  const rated = useMemo(() => new Map(swipes.map((s) => [s.id, s.rating])), [swipes]);
  const unrated = useMemo(() => CARDS.filter((c) => !rated.has(c.id)), [rated]);
  // The deck learns: everything is re-ranked from your ratings after each swipe, except the two cards
  // already on screen (the one under the top card shows while you drag, so it must be the one that arrives).
  // A card restored by Undo always comes back on top, even if filters would hide it.
  const onScreen = useRef([]);
  const whys = useRef(new Map()); // the one-line reason for each card, kept from the moment it was picked
  const deck = useMemo(() => {
    const pool = unrated.filter((c) => matches(c, filters));
    const allowed = new Set(pool.map((c) => c.id));
    const restored = state.back && !rated.has(state.back.id) && BY_ID.has(state.back.id) ? state.back.id : null;
    const pinned = [...new Set([restored, ...onScreen.current])].filter((id) => id && (id === restored || allowed.has(id))).slice(0, 2);
    const ranked = rank(swipes, pool, pinned, (id) => whys.current.get(id)?.from ?? null);
    for (const r of ranked) whys.current.set(r.id, r);
    const next = [...pinned, ...ranked.map((r) => r.id)].map((id) => BY_ID.get(id));
    onScreen.current = next.slice(0, 2).map((c) => c.id);
    return next;
  }, [unrated, filters, state.back, rated, swipes]);
  const top = deck[0];
  const raw = top ? rawTint(top, tints[top.id]) : "#3a4250";

  const rate = useCallback((rating, id, point) => {
    dispatch({ type: "rate", rating, id, at: Date.now() });
    if (point) setBurst({ ...point, key: Date.now() });
  }, []);
  const favorite = useCallback((id, point) => {
    dispatch({ type: "fav", id, at: Date.now() });
    if (point) setBurst({ ...point, key: Date.now() });
  }, []);
  const onTint = useCallback((id, colour) => setTints((t) => (t[id] ? t : { ...t, [id]: colour })), []);

  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify([...swipes, ...orphans.current]));
      localStorage.setItem(FILTER_STORE, JSON.stringify(filters));
      setSaveFailed(false);
    } catch {
      setSaveFailed(true);
    }
  }, [swipes, filters]);

  // Arrow keys and L rate the top card, but only on the swipe tab with no sheet open.
  const keys = useRef(null);
  keys.current = tab === "swipe" && !details && !filtersOpen ? top?.id : null;
  useEffect(() => {
    const onKey = (e) => {
      if (!keys.current || e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const rating = RATING_NAMES.find((r) => RATINGS[r].key === e.key);
      if (!rating) return;
      e.preventDefault();
      rate(rating, keys.current);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rate]);

  const backKey = state.back ? `${state.back.id}:${state.back.at}` : null;
  const flown = useRef(null);
  const back = flown.current === backKey ? null : state.back;
  useEffect(() => {
    if (tab === "swipe") flown.current = backKey;
  }, [backKey, tab]);

  // Worded once per action, so switching tabs or filters never re-announces an old message.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const live = useMemo(() => (state.note && tab === "swipe" ? `${state.note}. ${top ? `Next: ${top.title}` : "Nothing left in the deck"}` : state.note), [state]);
  const applyFilters = (next) => {
    dispatch({ type: "settle" });
    setFilters(next);
  };

  // Ask the browser not to evict saved ratings (a no-op where unsupported).
  useEffect(() => {
    navigator.storage?.persist?.().catch(() => {});
  }, []);

  const detailsCard = details && BY_ID.get(details);

  return (
    <MotionConfig reducedMotion="user">
      <div className="app tinted" style={{ "--raw": raw }}>
        {/* Ambient glow in the top card's colour. Two layers cross-fade; the gradient itself never animates. */}
        <div className="ambient" aria-hidden="true">
          <AnimatePresence initial={false}>
            <motion.div key={raw} className="tinted" style={{ "--raw": raw }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.6 }} />
          </AnimatePresence>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.main key={tab} className="screen" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
            {tab === "swipe" && (
              <Deck
                deck={deck}
                total={CARDS.length}
                leaving={state.leaving}
                back={back}
                tints={tints}
                whyOf={(id) => {
                  // A card on screen keeps the reason it was picked for, unless the rating behind that reason has since changed.
                  const reason = whys.current.get(id);
                  if (!reason?.why) return null;
                  if (reason.from) return ["liked", "want"].includes(rated.get(reason.from)) ? reason.why : null;
                  return swipes.length >= 3 ? reason.why : null;
                }}
                reduce={reduce}
                filters={filterCount(filters)}
                canUndo={swipes.length > 0}
                onRate={rate}
                onUndo={() => dispatch({ type: "undo" })}
                onDetails={setDetails}
                onFav={favorite}
                onTint={onTint}
                onFilters={() => setFiltersOpen(true)}
                onClearFilters={() => applyFilters(NO_FILTERS)}
                onLists={() => setTab("lists")}
              />
            )}
            {tab === "lists" && <Lists swipes={swipes} onOpen={setDetails} />}
            {tab === "search" && <Search swipes={swipes} onOpen={setDetails} />}
            {tab === "you" && <You swipes={swipes} onImport={(fresh) => {
              onScreen.current = []; // a batch of new ratings: rebuild the deck from the top
              dispatch({ type: "import", swipes: fresh });
            }} onReset={() => {
                orphans.current = []; // "erase all" means all
                onScreen.current = []; // and the deck starts over too
                dispatch({ type: "reset" });
              }} />}
          </motion.main>
        </AnimatePresence>

        <nav className="tabs" aria-label="Sections">
          {TABS.map(({ id, label, Icon }) => (
            <motion.button key={id} aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)} whileTap={{ scale: 0.94 }}>
              {tab === id && <motion.span layoutId="tab-pill" className="tab-pill" transition={{ type: "spring", bounce: 0.25, visualDuration: 0.35 }} />}
              <Icon size={24} weight={tab === id ? "fill" : "regular"} aria-hidden="true" />
              <span>{label}</span>
            </motion.button>
          ))}
        </nav>

        {detailsCard && (
          <Details
            card={detailsCard}
            rating={rated.get(details) ?? null}
            fav={swipes.some((s) => s.id === details && s.fav)}
            onFav={(id) => favorite(id)}
            onPick={(id, rating) => (rated.has(id) ? dispatch({ type: "set", id, rating }) : rate(rating, id))}
            onRemove={(id) => dispatch({ type: "remove", id })}
            onOpen={setDetails}
            onClose={() => setDetails(null)}
          />
        )}
        {filtersOpen && <Filters filters={filters} unrated={unrated} onApply={applyFilters} onClose={() => setFiltersOpen(false)} />}
        {burst && <Burst key={burst.key} at={burst} onDone={() => setBurst(null)} />}

        {saveFailed && (
          <p className="warn" role="alert">
            Ratings are not being saved on this device.
          </p>
        )}
        <p className="sr-only" aria-live="polite">
          {live}
        </p>
      </div>
    </MotionConfig>
  );
}
