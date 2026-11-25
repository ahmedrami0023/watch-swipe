import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "motion/react";
import { Cards, ListBullets, MagnifyingGlass, UserCircle } from "@phosphor-icons/react";
import { CARDS } from "./cards.js";
import Deck from "./Deck.jsx";
import { Lists, Search, You } from "./Pages.jsx";
import { Details, Filters } from "./Sheets.jsx";
import { rank } from "./learn.js";
import { BY_ID, FILTER_STORE, NO_FILTERS, RATINGS, STORE, filterCount, load, loadFilters, loadOrphans, matches, rawTint } from "./ratings.js";

const TABS = [
  { id: "swipe", label: "Discover", Icon: Cards },
  { id: "lists", label: "Lists", Icon: ListBullets },
  { id: "you", label: "You", Icon: UserCircle },
  { id: "search", label: "Search", Icon: MagnifyingGlass }, // search sits at the trailing end, as on iOS
];

function reducer(state, action) {
  const has = (id) => state.swipes.some((s) => s.id === id);
  const title = (id) => BY_ID.get(id).title;
  switch (action.type) {
    case "rate":
      if (!BY_ID.has(action.id) || has(action.id)) return state;
      return { swipes: [...state.swipes, { id: action.id, rating: action.rating, at: action.at }], note: `${title(action.id)}: ${RATINGS[action.rating].label}` };
    case "pass": {
      // Scrolled past without rating: not interested. Marked auto so these can be told apart from a tap later,
      // and not announced (it would speak on every scroll).
      const fresh = action.ids.filter((id) => BY_ID.has(id) && !has(id));
      if (!fresh.length) return state;
      return { ...state, swipes: [...state.swipes, ...fresh.map((id) => ({ id, rating: "pass", auto: true, at: action.at }))] };
    }
    case "set": // change a rating
      if (!has(action.id)) return state;
      return {
        // Re-rating to anything but Liked takes the title out of favourites.
        swipes: state.swipes.map((s) => (s.id === action.id ? { id: s.id, rating: action.rating, at: s.at, ...(s.fav && action.rating === "liked" && { fav: true }) } : s)),
        note: `${title(action.id)}: ${RATINGS[action.rating].label}`,
      };
    case "fav": {
      const current = state.swipes.find((s) => s.id === action.id);
      if (current) {
        const fav = !current.fav;
        // Favouriting something rated otherwise also marks it Liked.
        const next = fav ? { id: current.id, rating: "liked", at: current.at, fav: true } : { id: current.id, rating: current.rating, at: current.at };
        return { swipes: state.swipes.map((s) => (s === current ? next : s)), note: `${title(action.id)}: ${fav ? "added to" : "removed from"} favorites` };
      }
      // A favourite you haven't rated yet counts as seen and liked.
      if (!BY_ID.has(action.id)) return state;
      return { swipes: [...state.swipes, { id: action.id, rating: "liked", at: action.at, fav: true }], note: `${title(action.id)}: favorite. ${RATINGS.liked.label}` };
    }
    case "remove":
      if (!has(action.id)) return state;
      return { swipes: state.swipes.filter((s) => s.id !== action.id), note: `${title(action.id)}: rating removed` };
    case "import": {
      const fresh = action.swipes.filter((s) => !has(s.id));
      return { swipes: [...state.swipes, ...fresh], note: "" }; // the You page announces it
    }
    case "reset":
      return { swipes: [], note: "" };
    default:
      return state;
  }
}

// A ring and a few sparks where a favourite was tapped.
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
  const [state, dispatch] = useReducer(reducer, null, () => ({ swipes: load(), note: "" }));
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
  const favs = useMemo(() => new Set(swipes.filter((s) => s.fav).map((s) => s.id)), [swipes]);
  const unrated = useMemo(() => CARDS.filter((c) => !rated.has(c.id)), [rated]);
  const open = useMemo(() => unrated.filter((c) => matches(c, filters)), [unrated, filters]); // what the feed may still show

  // The feed: the titles shown so far this session, in order, plus the next few. Scrolling past a title marks it
  // "not interested"; every title stays where it is so you can scroll back and change your mind.
  // It learns: after each rating, everything beyond the page after the one on screen is picked again from your ratings.
  const [feed, setFeed] = useState([]);
  const [at, setAt] = useState(0); // which page is on screen
  const [run, setRun] = useState(0); // bumped to start the feed over (filters, import, erase, "Start over")
  const whys = useRef(new Map()); // the one-line reason for each card, kept from the moment it was picked
  // The furthest page reached. Everything up to the page after it is fixed; only what lies beyond is re-picked.
  // (Measured from the page on screen instead, scrolling back up would swap out the pages below, and scrolling
  // down again would then mark those new titles "not interested".)
  const furthest = useRef(0);
  useEffect(() => {
    furthest.current = Math.max(furthest.current, at);
    setFeed((was) => {
      const keep = was.slice(0, furthest.current + 2);
      const taken = new Set(keep);
      const pool = open.filter((c) => !taken.has(c.id));
      // Unrated titles just shown count toward the variety rules (rated ones already do).
      const seen = keep.slice(-6).filter((id) => !rated.has(id));
      const picked = rank(swipes, pool, seen, (id) => whys.current.get(id)?.from ?? null).slice(0, 3);
      for (const r of picked) whys.current.set(r.id, r);
      const next = [...keep, ...picked.map((r) => r.id)];
      return next.length === was.length && next.every((id, i) => id === was[i]) ? was : next;
    });
  }, [swipes, rated, open, at, run]);
  const restart = () => {
    furthest.current = 0;
    setFeed([]);
    setAt(0);
    setRun((r) => r + 1);
  };
  const cards = useMemo(() => feed.map((id) => BY_ID.get(id)), [feed]);
  const shown = useMemo(() => new Set(feed), [feed]);
  const ended = open.every((c) => shown.has(c.id)); // nothing more to add
  const top = cards[at];
  const raw = top ? rawTint(top, tints[top.id]) : "#3a4250";

  // The buttons toggle: the same rating again takes it off. Returns true when a rating was given or changed.
  const rate = (rating, id) => {
    const had = rated.get(id);
    if (had === rating) {
      dispatch({ type: "remove", id });
      return false;
    }
    dispatch(had ? { type: "set", id, rating } : { type: "rate", rating, id, at: Date.now() });
    return true;
  };
  const pass = useCallback((ids) => dispatch({ type: "pass", ids, at: Date.now() }), []);
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

  const applyFilters = (next) => {
    setFilters(next);
    restart();
  };

  // Ask the browser not to evict saved ratings (a no-op where unsupported).
  useEffect(() => {
    navigator.storage?.persist?.().catch(() => {});
  }, []);

  const detailsCard = details && BY_ID.get(details);

  return (
    <MotionConfig reducedMotion="user">
      <div className="app tinted" style={{ "--raw": raw }}>
        {/* Ambient glow in the current card's colour. Two layers cross-fade; the gradient itself never animates. */}
        <div className="ambient" aria-hidden="true">
          <AnimatePresence initial={false}>
            <motion.div key={raw} className="tinted" style={{ "--raw": raw }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.6 }} />
          </AnimatePresence>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.main key={tab} className="screen" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
            {tab === "swipe" && (
              <Deck
                key={run}
                feed={cards}
                at={at}
                ended={ended}
                left={open.length}
                rated={rated}
                favs={favs}
                tints={tints}
                whyOf={(id) => {
                  // A card keeps the reason it was picked for, unless the rating behind that reason has since changed.
                  const reason = whys.current.get(id);
                  if (!reason?.why) return null;
                  if (reason.from) return ["liked", "want"].includes(rated.get(reason.from)) ? reason.why : null;
                  return swipes.length >= 3 ? reason.why : null;
                }}
                reduce={reduce}
                filters={filterCount(filters)}
                onAt={setAt}
                onRate={rate}
                onPass={pass}
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
              dispatch({ type: "import", swipes: fresh });
              restart(); // a batch of new ratings: start the feed over
            }} onReset={() => {
                orphans.current = []; // "erase all" means all
                dispatch({ type: "reset" });
                restart(); // and the feed starts over too
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
            onPick={(id, rating) => rate(rating, id)}
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
          {state.note}
        </p>
      </div>
    </MotionConfig>
  );
}
