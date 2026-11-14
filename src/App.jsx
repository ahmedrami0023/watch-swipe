import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "motion/react";
import { Cards, ListBullets, UserCircle } from "@phosphor-icons/react";
import { CARDS } from "./cards.js";
import Deck from "./Deck.jsx";
import { Lists, You } from "./Pages.jsx";
import { Details, Filters } from "./Sheets.jsx";
import { BY_ID, FILTER_STORE, NO_FILTERS, RATINGS, RATING_NAMES, STORE, filterCount, load, loadFilters, matches, rawTint } from "./ratings.js";

const TABS = [
  { id: "swipe", label: "Swipe", Icon: Cards },
  { id: "lists", label: "Lists", Icon: ListBullets },
  { id: "you", label: "You", Icon: UserCircle },
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
        swipes: state.swipes.map((s) => (s.id === action.id ? { ...s, rating: action.rating } : s)),
        leaving: null,
        back: null,
        note: `${title(action.id)}: ${RATINGS[action.rating].label}`,
      };
    case "remove":
      if (!has(action.id)) return state;
      return { swipes: state.swipes.filter((s) => s.id !== action.id), leaving: null, back: null, note: `${title(action.id)} is back in the deck` };
    case "import": {
      const fresh = action.swipes.filter((s) => !has(s.id));
      return { swipes: [...state.swipes, ...fresh], leaving: null, back: null, note: "" }; // the You page announces it
    }
    case "reset":
      return { swipes: [], leaving: null, back: null, note: "" };
    case "settle": // the deck changed for another reason (filters): the top card must not leave as if it were rated
      return state.leaving ? { ...state, leaving: null } : state;
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
  const root = useRef(null);
  const { swipes } = state;

  const rated = useMemo(() => new Map(swipes.map((s) => [s.id, s.rating])), [swipes]);
  const unrated = useMemo(() => CARDS.filter((c) => !rated.has(c.id)), [rated]);
  const deck = useMemo(() => {
    const backId = state.back?.id;
    const rest = unrated.filter((c) => matches(c, filters) && c.id !== backId);
    const restored = backId && !rated.has(backId) ? BY_ID.get(backId) : null;
    return restored ? [restored, ...rest] : rest;
  }, [unrated, filters, state.back, rated]);
  const top = deck[0];
  const raw = top ? rawTint(top, tints[top.id]) : "#3a4250";

  const rate = useCallback((rating, id, point) => {
    dispatch({ type: "rate", rating, id, at: Date.now() });
    if (point) setBurst({ ...point, key: Date.now() });
  }, []);
  const onTint = useCallback((id, colour) => setTints((t) => (t[id] ? t : { ...t, [id]: colour })), []);
  // Blur is expensive under a moving card, so glass goes solid for the length of a drag (no re-render).
  const onDragging = useCallback((on) => root.current?.toggleAttribute("data-dragging", on), []);

  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify(swipes));
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
      <div className="app tinted" ref={root} style={{ "--raw": raw }}>
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
                reduce={reduce}
                filters={filterCount(filters)}
                canUndo={swipes.length > 0}
                onRate={rate}
                onUndo={() => dispatch({ type: "undo" })}
                onDetails={setDetails}
                onTint={onTint}
                onFilters={() => setFiltersOpen(true)}
                onClearFilters={() => applyFilters(NO_FILTERS)}
                onLists={() => setTab("lists")}
                onDragging={onDragging}
              />
            )}
            {tab === "lists" && <Lists swipes={swipes} onOpen={setDetails} />}
            {tab === "you" && <You swipes={swipes} onImport={(fresh) => dispatch({ type: "import", swipes: fresh })} onReset={() => dispatch({ type: "reset" })} />}
          </motion.main>
        </AnimatePresence>

        <nav className="tabs glass" aria-label="Sections">
          {TABS.map(({ id, label, Icon }) => (
            <button key={id} aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}>
              {tab === id && <motion.span layoutId="tab-pill" className="tab-pill" transition={{ type: "spring", bounce: 0.2, visualDuration: 0.3 }} />}
              <Icon size={24} weight={tab === id ? "fill" : "regular"} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        {detailsCard && (
          <Details
            card={detailsCard}
            rating={rated.get(details) ?? null}
            onPick={(id, rating) => (rated.has(id) ? dispatch({ type: "set", id, rating }) : rate(rating, id))}
            onRemove={(id) => dispatch({ type: "remove", id })}
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
