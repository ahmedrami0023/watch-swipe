import { useEffect, useReducer, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  AnimatePresence,
  motion,
  useIsPresent,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "motion/react";
import { CARDS } from "./cards.js";

const STORE = "watch-swipe:v2"; // v2 saves the rating, not the gesture
const DOUBLE_TAP = 320; // ms between two taps that count as a double-tap
const THRESHOLD = 90; // px of travel that commits a swipe
const FLICK = 600; // px/s that commits a short, fast swipe

// Left/right handle titles you haven't seen (the common case); double-tap is the usual "like".
const RATINGS = {
  pass: { label: "Not interested", prefix: "", short: "Not interested", swipe: "left", key: "ArrowLeft", glyph: "←" },
  disliked: { label: "Seen it, didn't like it", prefix: "Seen it, ", short: "Didn't like it", swipe: "down", key: "ArrowDown", glyph: "↓" },
  liked: { label: "Seen it, liked it", prefix: "Seen it, ", short: "Liked it", swipe: null, key: "l", glyph: "2×" },
  unsure: { label: "Haven't seen it, not sure", prefix: "Haven't seen it, ", short: "Not sure", swipe: "up", key: "ArrowUp", glyph: "↑" },
  want: { label: "Want to watch", prefix: "", short: "Want to watch", swipe: "right", key: "ArrowRight", glyph: "→" },
};
const RATING_NAMES = Object.keys(RATINGS);
const BY_SWIPE = Object.fromEntries(RATING_NAMES.filter((r) => RATINGS[r].swipe).map((r) => [RATINGS[r].swipe, r]));

// Saved swipes are untrusted input: keep only known cards and ratings, one entry per card.
function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? "[]");
    if (!Array.isArray(raw)) return [];
    const known = new Set(CARDS.map((c) => c.id));
    return raw.filter((s) => s && Object.hasOwn(RATINGS, s.rating) && known.delete(s.id));
  } catch {
    return [];
  }
}

// Cards not swiped yet, in deck order. [0] is the one on top.
const remaining = (swipes) => {
  const done = new Set(swipes.map((s) => s.id));
  return CARDS.filter((c) => !done.has(c.id));
};

function reducer(state, action) {
  if (action.type === "swipe") {
    const [card, next] = remaining(state.swipes);
    // A drag names its card, so a late drag on a card that is already flying off is ignored.
    if (!card || (action.id && action.id !== card.id)) return state;
    return {
      swipes: [...state.swipes, { id: card.id, rating: action.rating, at: action.at }],
      exit: action.rating,
      note: `${card.title}: ${RATINGS[action.rating].label}. ${next ? `Next: ${next.title}` : "Deck finished"}`,
    };
  }
  if (action.type === "undo") {
    const last = state.swipes.at(-1);
    if (!last) return state;
    const title = CARDS.find((c) => c.id === last.id).title;
    // exit: null makes the card that was on top vanish instead of flying off as if it had been rated.
    return { swipes: state.swipes.slice(0, -1), exit: null, note: `Undid. Back to ${title}` };
  }
  if (action.type === "reset") return { swipes: [], exit: null, note: `Deck reset. Next: ${CARDS[0].title}` };
  return state;
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, null, () => ({ swipes: load(), exit: null, note: "" }));
  const [saveFailed, setSaveFailed] = useState(false);
  const [details, setDetails] = useState(null); // the card whose details sheet is open
  const detailsOpen = useRef(false);
  detailsOpen.current = !!details;
  const reduce = useReducedMotion();
  const controls = useRef(null);
  const { swipes } = state;
  const [top, peek] = remaining(swipes);

  const rate = (rating, id) => dispatch({ type: "swipe", rating, id, at: Date.now() });
  const reset = () => {
    flushSync(() => dispatch({ type: "reset" }));
    controls.current?.querySelector("button")?.focus(); // Start over just unmounted, so hand focus on
  };

  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify(swipes));
      setSaveFailed(false);
    } catch {
      setSaveFailed(true);
    }
  }, [swipes]);

  useEffect(() => {
    const onKey = (e) => {
      if (detailsOpen.current || e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const rating = RATING_NAMES.find((r) => RATINGS[r].key === e.key);
      if (!rating) return;
      e.preventDefault();
      dispatch({ type: "swipe", rating, at: Date.now() });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app">
      <header className="bar">
        <h1>Watch Swipe</h1>
        <p className="count">
          {swipes.length} of {CARDS.length}
        </p>
        <button className="ghost" onClick={() => dispatch({ type: "undo" })} aria-disabled={!swipes.length}>
          Undo
        </button>
      </header>

      <main className="stage">
        {peek && <CardFace card={peek} className="card peek" aria-hidden="true" />}
        <AnimatePresence custom={{ rating: state.exit, reduce }} initial={false}>
          {top && <SwipeCard key={top.id} card={top} onRate={rate} onDetails={setDetails} reduce={reduce} />}
        </AnimatePresence>
        {!top && <Finished swipes={swipes} onReset={reset} />}
      </main>

      <nav className="controls" aria-label="Rate this title" ref={controls}>
        {RATING_NAMES.map((rating) => (
          <button
            key={rating}
            data-rating={rating}
            onClick={() => rate(rating)}
            disabled={!top}
            aria-keyshortcuts={RATINGS[rating].key}
          >
            <span className="arrow" aria-hidden="true">
              {RATINGS[rating].glyph}
            </span>
            <span>
              <span className="sr-only">{RATINGS[rating].prefix}</span>
              {RATINGS[rating].short}
            </span>
          </button>
        ))}
      </nav>

      {details && <Details card={details} onClose={() => setDetails(null)} />}

      {saveFailed && (
        <p className="warn" role="alert">
          Swipes are not being saved on this device.
        </p>
      )}
      <p className="sr-only" aria-live="polite">
        {state.note}
      </p>
    </div>
  );
}

function CardFace({ as: Tag = "article", card, onDetails, children, ...rest }) {
  return (
    <Tag {...rest}>
      <div className="poster" style={{ "--hue": card.hue }}>
        {card.image && <img src={card.image} alt="" draggable="false" />}
        <h2>{card.title}</h2>
      </div>
      <div className="meta">
        {onDetails && (
          <button className="ghost info" onClick={() => onDetails(card)}>
            Details
          </button>
        )}
        <p className="kind">
          {card.type} · {card.year}
        </p>
        <p className="genres">{card.genres}</p>
        <dl className="scores">
          <div>
            <dt>IMDb</dt>
            <dd>soon</dd>
          </div>
          <div>
            <dt>Rotten Tomatoes</dt>
            <dd>soon</dd>
          </div>
        </dl>
      </div>
      {children}
    </Tag>
  );
}

const cardVariants = {
  enter: { scale: 0.95 },
  // x, y and opacity are named so a card whose exit is cut short by Undo animates back to rest.
  center: { scale: 1, x: 0, y: 0, opacity: 1 },
  exit: ({ rating, reduce }) => {
    if (!rating) return { opacity: 0, transition: { duration: 0 } }; // replaced by Undo, not rated
    const dir = RATINGS[rating].swipe;
    if (!dir) return { scale: 1.08, opacity: 0, transition: { duration: reduce ? 0.01 : 0.25 } }; // double-tap: pops
    const off = dir === "left" || dir === "right" ? { x: dir === "right" ? 640 : -640 } : { y: dir === "down" ? 900 : -900 };
    // The spring picks up the finger's release speed, so a flick keeps its momentum.
    const transition = reduce
      ? { duration: 0.01 }
      : { default: { type: "spring", bounce: 0, visualDuration: 0.3 }, opacity: { duration: 0.28, ease: "easeIn" } };
    return { ...off, opacity: 0, transition };
  },
};

function SwipeCard({ card, onRate, onDetails, reduce }) {
  const lastTap = useRef(0);
  const single = useRef(0); // timer that turns a lone tap on the picture into "open details"
  useEffect(() => () => clearTimeout(single.current), []);
  const isPresent = useIsPresent();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-240, 240], reduce ? [0, 0] : [-9, 9]);

  const onDragEnd = (_, { offset, velocity }) => {
    const horizontal = Math.abs(offset.x) > Math.abs(offset.y);
    const dist = horizontal ? offset.x : offset.y;
    const speed = horizontal ? velocity.x : velocity.y;
    const flicked = Math.abs(dist) > 24 && dist * speed > 0 && Math.abs(speed) > FLICK;
    if (Math.abs(dist) < THRESHOLD && !flicked) return; // springs back via dragSnapToOrigin
    onRate(BY_SWIPE[horizontal ? (dist > 0 ? "right" : "left") : dist > 0 ? "down" : "up"], card.id);
  };

  // Motion only fires onTap when the press did not turn into a drag.
  const onTap = (e) => {
    if (e.target.closest?.("button")) return; // the Details button handles itself
    clearTimeout(single.current);
    if (e.timeStamp - lastTap.current < DOUBLE_TAP) {
      lastTap.current = 0;
      return onRate("liked", card.id);
    }
    lastTap.current = e.timeStamp;
    // Wait out the double-tap window before treating it as a single tap.
    if (e.target.closest?.(".poster")) single.current = setTimeout(() => onDetails(card), DOUBLE_TAP);
  };

  return (
    <CardFace
      as={motion.article}
      card={card}
      onDetails={onDetails}
      className="card"
      aria-label={`${card.title}, ${card.type}, ${card.year}`}
      style={{ x, y, rotate, zIndex: isPresent ? 1 : 2, pointerEvents: isPresent ? "auto" : "none" }}
      drag={isPresent}
      dragSnapToOrigin
      onDragEnd={onDragEnd}
      onTap={onTap}
      variants={cardVariants}
      custom={{ rating: null, reduce }}
      initial="enter"
      animate="center"
      exit="exit"
    >
      {Object.keys(BY_SWIPE).map((dir) => (
        <Stamp key={dir} dir={dir} x={x} y={y} />
      ))}
    </CardFace>
  );
}

// Fades in the label for whichever direction the card is currently being pulled.
function Stamp({ dir, x, y }) {
  const opacity = useTransform(() => {
    const dx = x.get();
    const dy = y.get();
    const horizontal = Math.abs(dx) > Math.abs(dy);
    if ((dir === "left" || dir === "right") !== horizontal) return 0;
    const pull = dir === "right" ? dx : dir === "left" ? -dx : dir === "down" ? dy : -dy;
    return Math.min(Math.max(pull / THRESHOLD, 0), 1);
  });
  return (
    <motion.span className="stamp" data-dir={dir} style={{ opacity }} aria-hidden="true">
      {RATINGS[BY_SWIPE[dir]].label}
    </motion.span>
  );
}

function Details({ card, onClose }) {
  const dialog = useRef(null);
  useEffect(() => {
    dialog.current.showModal();
  }, []);
  return (
    <dialog
      className="details"
      ref={dialog}
      onClose={onClose}
      onClick={(e) => e.target === dialog.current && dialog.current.close()} // tap outside the sheet
      aria-labelledby="details-title"
    >
      <div className="sheet">
        <button className="ghost close" onClick={() => dialog.current.close()}>
          Close
        </button>
        {card.image && (
          <div className="poster">
            <img src={card.image} alt={`Poster for ${card.title}`} />
          </div>
        )}
        <h2 id="details-title">{card.title}</h2>
        <p className="kind">
          {card.type} · {card.year}
        </p>
        <p className="genres">{card.genres}</p>
        <dl className="scores">
          <div>
            <dt>IMDb</dt>
            <dd>soon</dd>
          </div>
          <div>
            <dt>Rotten Tomatoes</dt>
            <dd>soon</dd>
          </div>
          <div>
            <dt>Where to stream</dt>
            <dd>soon</dd>
          </div>
        </dl>
        {card.summary && <p className="summary">{card.summary}</p>}
        {card.source && (
          <p className="credit">
            Summary{card.image ? " and image" : ""} from{" "}
            <a href={card.source} target="_blank" rel="noreferrer">
              Wikipedia
            </a>
            . Cast, runtime and scores arrive with real data.
          </p>
        )}
      </div>
    </dialog>
  );
}

function Finished({ swipes, onReset }) {
  // The rating buttons just became disabled, so move focus here instead of losing it.
  const heading = useRef(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <section className="finished">
      <h2 tabIndex={-1} ref={heading}>
        Deck finished
      </h2>
      <dl>
        {["liked", "disliked", "want", "unsure", "pass"].map((rating) => (
          <div key={rating}>
            <dt>{RATINGS[rating].label}</dt>
            <dd>{swipes.filter((s) => s.rating === rating).length}</dd>
          </div>
        ))}
      </dl>
      <button className="ghost" onClick={onReset}>
        Start over
      </button>
    </section>
  );
}
