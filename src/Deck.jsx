// The swipe screen: full-screen poster cards, the five rating buttons and the top pills.
import { useEffect, useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  useIsPresent,
  useMotionValue,
  useMotionValueEvent,
  usePresenceData,
  useTransform,
} from "motion/react";
import { ArrowCounterClockwise, SlidersHorizontal } from "@phosphor-icons/react";
import { BY_SWIPE, DOUBLE_TAP, FLICK, RATINGS, RATING_NAMES, THRESHOLD, progress, rawTint, sample } from "./ratings.js";

// Poster image. crossOrigin lets us read its colour; a broken link falls back to a tinted block.
export function Poster({ card, className, alt = "", onTint }) {
  const [failed, setFailed] = useState(false);
  if (!card.image || failed) return <div className={`${className} blank`} role={alt ? "img" : undefined} aria-label={alt || undefined} />;
  return (
    <img
      className={className}
      src={card.image}
      alt={alt}
      crossOrigin="anonymous"
      draggable="false"
      decoding="async"
      onLoad={
        onTint && !card.color
          ? (e) => {
              const colour = sample(e.currentTarget);
              if (colour) onTint(card.id, colour);
            }
          : undefined
      }
      onError={() => setFailed(true)}
    />
  );
}

function CardFace({ card, onTint, onDetails, children }) {
  return (
    <>
      <Poster card={card} className="art" onTint={onTint} />
      <div className="scrim" />
      <div className="info">
        <h2>{card.title}</h2>
        <p className="sub">
          <span>
            {card.type} · {card.year}
          </span>
          {card.genres.length > 0 && <span>{card.genres.slice(0, 2).join(", ")}</span>}
        </p>
        <div className="pills">
          {card.score && (
            <span className="pill solid stat">
              {card.score.label} <b>{card.score.value}</b>
            </span>
          )}
          {onDetails && (
            <button className="pill solid" onClick={() => onDetails(card.id)}>
              Details
            </button>
          )}
        </div>
      </div>
      {children}
    </>
  );
}

// Where a card ends up for each rating. Also where it flies back in from on Undo.
function awayPose(rating) {
  const w = window.innerWidth * 1.4;
  const h = window.innerHeight * 1.2;
  return { want: { x: w }, pass: { x: -w }, unsure: { y: -h, scale: 0.9 }, disliked: { y: h }, liked: { scale: 1.12 } }[rating];
}
const SWIPE_SPRING = { want: 0.32, pass: 0.32, unsure: 0.4, disliked: 0.28 }; // seconds; up floats, down drops

const cardVariants = {
  // x, y and opacity are named so a card whose exit is cut short by Undo animates back to rest.
  center: ({ undo }) => ({
    scale: 1,
    x: 0,
    y: 0,
    opacity: 1,
    transition: { type: "spring", bounce: undo ? 0.25 : 0.15, visualDuration: undo ? 0.45 : 0.35 },
  }),
  exit: ({ rating }) => {
    // Not rated (Undo, filters, reset): step back into the stack instead of flying off.
    if (!rating) return { scale: 0.94, opacity: 0, transition: { duration: 0.2 } };
    if (rating === "liked") return { ...awayPose(rating), opacity: 0, transition: { duration: 0.3, ease: "easeOut" } };
    // A spring picks up the finger's release speed, so a flick keeps its momentum.
    return {
      ...awayPose(rating),
      opacity: 0,
      transition: { default: { type: "spring", bounce: 0, visualDuration: SWIPE_SPRING[rating] }, opacity: { duration: 0.28, ease: "easeIn" } },
    };
  },
};

function SwipeCard({ card, raw, shared, pull, enterFrom, reduce, onRate, onDetails, onTint, onDragging }) {
  const isPresent = useIsPresent();
  const leaving = usePresenceData(); // { rating } once this card is on its way out
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-240, 240], reduce ? [0, 0] : [-12, 12]);
  const lastTap = useRef(0);
  const single = useRef(0); // timer that turns a lone tap into "open details"
  const travel = useRef(0); // how far the finger moved during this press
  useEffect(() => () => clearTimeout(single.current), []);
  // Once the card is on its way out, a pending single tap must not open its details.
  useEffect(() => {
    if (!isPresent) clearTimeout(single.current);
  }, [isPresent]);

  // Mirror this card's position to the buttons and the card underneath, but only while it is the live card.
  const live = useRef(true);
  live.current = isPresent;
  useMotionValueEvent(x, "change", (v) => live.current && shared.x.set(v));
  useMotionValueEvent(y, "change", (v) => live.current && shared.y.set(v));

  // Start where the card underneath already was (no pop), or where Undo's card flew off to.
  const [initial] = useState(() => (enterFrom ? { ...awayPose(enterFrom), opacity: enterFrom === "liked" ? 0 : 1 } : { scale: 0.94 + 0.06 * pull.get() }));

  const onDragEnd = (event, { offset, velocity }) => {
    onDragging(false);
    if (event.type === "pointercancel") return; // iOS took the gesture (edge swipe, Control Center): never rate
    const horizontal = Math.abs(offset.x) > Math.abs(offset.y);
    const dist = horizontal ? offset.x : offset.y;
    const speed = horizontal ? velocity.x : velocity.y;
    const flicked = Math.abs(dist) > 24 && dist * speed > 0 && Math.abs(speed) > FLICK;
    if (Math.abs(dist) < THRESHOLD && !flicked) return; // springs back via dragSnapToOrigin
    onRate(BY_SWIPE[horizontal ? (dist > 0 ? "right" : "left") : dist > 0 ? "down" : "up"], card.id);
  };

  // Motion only fires onTap when the press did not turn into a drag.
  const onTap = (e, info) => {
    if (travel.current >= 10) return; // that was a swipe or a spring-back, not a tap
    if (e.target.closest?.("button")) return; // the Details pill handles itself
    clearTimeout(single.current);
    if (e.timeStamp - lastTap.current < DOUBLE_TAP) {
      lastTap.current = 0;
      return onRate("liked", card.id, info.point);
    }
    lastTap.current = e.timeStamp;
    // Wait out the double-tap window; skip it if a sheet opened in the meantime.
    single.current = setTimeout(() => !document.querySelector("dialog[open]") && onDetails(card.id), DOUBLE_TAP);
  };

  return (
    <motion.article
      className="card tinted"
      aria-label={`${card.title}, ${card.type}, ${card.year}`}
      style={{ x, y, rotate, "--raw": raw, zIndex: isPresent ? 2 : leaving?.rating ? 3 : 1, pointerEvents: isPresent ? "auto" : "none" }}
      drag={isPresent}
      dragSnapToOrigin
      whileDrag={{ scale: 1.03 }}
      onPointerDown={() => (travel.current = 0)}
      onDragStart={() => {
        clearTimeout(single.current);
        onDragging(true);
      }}
      onDrag={(_, info) => (travel.current = Math.max(travel.current, Math.hypot(info.offset.x, info.offset.y)))}
      onDragEnd={onDragEnd}
      onTap={onTap}
      variants={cardVariants}
      custom={{ rating: null, undo: !!enterFrom }}
      initial={initial}
      animate="center"
      exit="exit"
    >
      <CardFace card={card} onTint={onTint} onDetails={onDetails}>
        {Object.keys(BY_SWIPE).map((dir) => (
          <Stamp key={dir} dir={dir} x={x} y={y} />
        ))}
      </CardFace>
    </motion.article>
  );
}

// The label that lands on the card for whichever direction it is being pulled.
function Stamp({ dir, x, y }) {
  const rating = BY_SWIPE[dir];
  const { Icon, label } = RATINGS[rating];
  const amount = useTransform(() => progress(dir, x.get(), y.get()));
  const opacity = useTransform(amount, [0.15, 1], [0, 1]);
  const scale = useTransform(amount, [0.15, 1], [1.25, 1]);
  return (
    <motion.span className="stamp" data-dir={dir} data-rating={rating} style={{ opacity, scale }} aria-hidden="true">
      <Icon size={20} weight="bold" />
      {label}
    </motion.span>
  );
}

// The next card, waiting underneath. It grows toward full size as the top card is pulled away.
function Peek({ card, raw, pull, onTint }) {
  const scale = useTransform(pull, [0, 1], [0.94, 1]);
  const opacity = useTransform(pull, [0, 1], [0.5, 1]);
  return (
    <motion.article className="card peek tinted" aria-hidden="true" style={{ scale, opacity, "--raw": raw }}>
      <CardFace card={card} onTint={onTint} />
    </motion.article>
  );
}

function RateButton({ name, shared, disabled, onClick }) {
  const { Icon, label, short, swipe, key, solid } = RATINGS[name];
  const size = name === "liked" ? 28 : 24;
  // Fills with its colour as the card is dragged its way.
  const fill = useTransform(() => (swipe ? progress(swipe, shared.x.get(), shared.y.get()) : 0));
  return (
    <motion.button
      className="rate"
      data-rating={name}
      disabled={disabled}
      onClick={onClick}
      aria-label={`${short}: ${label}`}
      aria-keyshortcuts={key}
      whileTap={{ scale: 0.88 }}
      transition={{ type: "spring", bounce: 0.4, visualDuration: 0.18 }}
    >
      <span className="disc">
        <Icon size={size} weight={name === "liked" ? "fill" : "bold"} aria-hidden="true" />
        {swipe && (
          <motion.span className="fill" style={{ opacity: fill }} aria-hidden="true">
            <Icon size={size} weight={solid} />
          </motion.span>
        )}
      </span>
      <span aria-hidden="true">{short}</span>
    </motion.button>
  );
}

function Empty({ filtered, total, onFilters, onClear, onLists }) {
  // The rating buttons just became disabled, so move focus here instead of losing it.
  const heading = useRef(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <section className="deck-empty">
      <h2 tabIndex={-1} ref={heading}>
        {filtered ? "Nothing left here" : "Deck finished"}
      </h2>
      <p>{filtered ? "You've rated everything that fits these filters." : `You've rated all ${total} titles.`}</p>
      <div className="actions">
        {filtered && (
          <>
            <button className="btn primary" onClick={onFilters}>
              Change filters
            </button>
            <button className="btn" onClick={onClear}>
              Clear filters
            </button>
          </>
        )}
        {!filtered && (
          <button className="btn primary" onClick={onLists}>
            Open lists
          </button>
        )}
      </div>
    </section>
  );
}

export default function Deck({ deck, total, leaving, back, tints, reduce, filters, canUndo, onRate, onUndo, onDetails, onTint, onFilters, onClearFilters, onLists, onDragging }) {
  const [top, next, third] = deck;
  const dragX = useMotionValue(0);
  const dragY = useMotionValue(0);
  const shared = useRef({ x: dragX, y: dragY }).current;
  const pull = useTransform(() => Math.min(Math.hypot(dragX.get(), dragY.get()) / THRESHOLD, 1));

  // A new top card starts centred, so the shared position resets with it.
  useEffect(() => {
    dragX.jump(0);
    dragY.jump(0);
  }, [top?.id, dragX, dragY]);

  // Warm up the picture two cards down so it is ready when it surfaces.
  useEffect(() => {
    if (!third?.image) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = third.image;
  }, [third]);

  return (
    <section className="deck">
      <div className="stage">
        {next && <Peek key={next.id} card={next} raw={rawTint(next, tints[next.id])} pull={pull} onTint={onTint} />}
        <AnimatePresence custom={{ rating: leaving }} initial={false}>
          {top && (
            <SwipeCard
              key={top.id}
              card={top}
              raw={rawTint(top, tints[top.id])}
              shared={shared}
              pull={pull}
              enterFrom={back?.id === top.id ? back.rating : null}
              reduce={reduce}
              onRate={onRate}
              onDetails={onDetails}
              onTint={onTint}
              onDragging={onDragging}
            />
          )}
        </AnimatePresence>
        {!top && <Empty filtered={filters > 0} total={total} onFilters={onFilters} onClear={onClearFilters} onLists={onLists} />}
      </div>

      <div className="topbar">
        <button className="pill glass" onClick={onFilters}>
          <SlidersHorizontal size={18} weight="bold" aria-hidden="true" />
          <span className="txt">Filters</span>
          {filters > 0 && (
            <b className="badge" aria-label={`${filters} active`}>
              {filters}
            </b>
          )}
        </button>
        <p className="pill glass stat">
          <span className="sr-only">{deck.length} left</span>
          <span className="tick" aria-hidden="true">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.b key={deck.length} initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -8, opacity: 0 }} transition={{ duration: 0.18 }}>
                {deck.length}
              </motion.b>
            </AnimatePresence>
          </span>
          <span aria-hidden="true">left</span>
        </p>
        <button className="pill glass" onClick={onUndo} aria-disabled={!canUndo}>
          <ArrowCounterClockwise size={18} weight="bold" aria-hidden="true" />
          <span className="txt">Undo</span>
        </button>
      </div>

      <nav className="rate-row" aria-label="Rate this title">
        {RATING_NAMES.map((name) => (
          <RateButton key={name} name={name} shared={shared} disabled={!top} onClick={() => top && onRate(name, top.id)} />
        ))}
      </nav>
    </section>
  );
}
