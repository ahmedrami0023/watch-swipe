// The feed: one full-screen title per page, scrolled like short videos. The five buttons rate the title on screen.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { SlidersHorizontal } from "@phosphor-icons/react";
import { FAV, RATINGS, RATING_NAMES, imageUrl, rawTint, sample } from "./ratings.js";

// Poster image. crossOrigin lets us read its colour; a broken link falls back to a tinted block.
export function Poster({ card, path = card.poster, size = "w780", className, alt = "", onTint }) {
  const [failed, setFailed] = useState(false);
  if (!path || failed) return <div className={`${className} blank`} role={alt ? "img" : undefined} aria-label={alt || undefined} />;
  return (
    <img
      className={className}
      src={imageUrl(path, size)}
      alt={alt}
      crossOrigin="anonymous"
      draggable="false"
      decoding="async"
      loading={size === "w154" ? "lazy" : undefined}
      onLoad={
        onTint
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

// One title, filling the screen. Tapping the picture opens its details (the Details pill does the same for keyboards).
function Slide({ card, why, raw, fav, onTint, onDetails, onFav }) {
  return (
    <article
      className="card tinted"
      aria-label={`${card.title}, ${card.type}, ${card.year}`}
      style={{ "--raw": raw }}
      onClick={(e) => !e.target.closest("button") && onDetails(card.id)}
    >
      <Poster card={card} className="art" onTint={onTint} />
      <div className="scrim" />
      <div className="info">
        {why && <p className="why">{why}</p>}
        <h2>{card.title}</h2>
        <p className="sub">
          <span>
            {card.type} · {card.year}
          </span>
          {card.genres.length > 0 && <span>{card.genres.slice(0, 2).join(", ")}</span>}
        </p>
        <div className="pills">
          {card.rating != null && (
            <span className="pill solid stat">
              TMDB <b>{card.rating.toFixed(1)}</b>
            </span>
          )}
          <button className="pill solid" onClick={() => onDetails(card.id)}>
            Details
          </button>
          <button
            className="pill solid icon"
            data-rating="fav"
            aria-pressed={fav}
            aria-label="Favorite: seen it and loved it"
            onClick={(e) => {
              // A keyboard press has no pointer position: burst from the button.
              const box = e.currentTarget.getBoundingClientRect();
              const point = e.detail === 0 ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : { x: e.clientX, y: e.clientY };
              onFav(card.id, fav ? null : point);
            }}
          >
            <FAV.Icon size={20} weight={fav ? "fill" : "bold"} aria-hidden="true" />
          </button>
        </div>
      </div>
    </article>
  );
}

function RateButton({ name, on, disabled, onClick }) {
  const { Icon, label, short, solid } = RATINGS[name];
  return (
    <motion.button
      className="rate"
      data-rating={name}
      disabled={disabled}
      aria-pressed={on}
      onClick={onClick}
      aria-label={`${short}: ${label}`}
      whileTap={{ scale: 0.88 }}
      transition={{ type: "spring", bounce: 0.4, visualDuration: 0.18 }}
    >
      <span className="disc">
        <Icon size={name === "liked" ? 28 : 24} weight={on ? solid : "bold"} aria-hidden="true" />
      </span>
      <span aria-hidden="true">{short}</span>
    </motion.button>
  );
}

function End({ filtered, skipped, onFilters, onClear, onLists, onRestart }) {
  return (
    <section className="deck-empty">
      <h2>{filtered ? "Nothing left here" : "That's everything"}</h2>
      <p>
        {skipped
          ? "You've scrolled through every title that fits. The ones you didn't rate come around again."
          : filtered
            ? "You've rated everything that fits these filters."
            : "You've rated every title."}
      </p>
      <div className="actions">
        {skipped && (
          <button className="btn primary" onClick={onRestart}>
            Start over
          </button>
        )}
        {filtered && (
          <>
            <button className={skipped ? "btn" : "btn primary"} onClick={onFilters}>
              Change filters
            </button>
            <button className="btn" onClick={onClear}>
              Clear filters
            </button>
          </>
        )}
        {!filtered && !skipped && (
          <button className="btn primary" onClick={onLists}>
            Open lists
          </button>
        )}
      </div>
    </section>
  );
}

// feed: the titles shown so far this session plus the next few, in order. at: which page is on screen.
// ended: nothing more to add, so a closing page follows the last title.
export default function Deck({ feed, at, ended, left, rated, favs, tints, whyOf, reduce, filters, onAt, onRate, onDetails, onFav, onTint, onFilters, onClearFilters, onLists, onRestart }) {
  const scroller = useRef(null);
  const current = feed[at];
  const pages = feed.length + (ended ? 1 : 0);

  // Coming back from another tab: return to the page you were on.
  useLayoutEffect(() => {
    scroller.current.scrollTop = at * scroller.current.clientHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const go = (i) => {
    const el = scroller.current;
    if (el && i >= 0 && i < pages) el.scrollTo({ top: i * el.clientHeight, behavior: reduce ? "auto" : "smooth" });
  };
  const goRef = useRef(go);
  goRef.current = go;
  const atRef = useRef(at);
  atRef.current = at;

  // Up and down arrows (and Page Up/Down) move through the feed when no sheet is open.
  useEffect(() => {
    const onKey = (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey || document.querySelector("dialog[open]") || e.target.closest?.("input, textarea")) return;
      const step = { ArrowDown: 1, PageDown: 1, ArrowUp: -1, PageUp: -1 }[e.key];
      if (!step) return;
      e.preventDefault();
      goRef.current(atRef.current + step);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // After a rating the feed moves on by itself, unless you already scrolled away.
  const advance = useRef(0);
  useEffect(() => () => clearTimeout(advance.current), []);
  const press = (name) => {
    if (!current) return;
    const from = at;
    clearTimeout(advance.current);
    if (onRate(name, current.id)) advance.current = setTimeout(() => atRef.current === from && goRef.current(from + 1), 320);
  };

  return (
    <section className="deck">
      <div
        className="feed"
        ref={scroller}
        onScroll={(e) => {
          const i = Math.round(e.currentTarget.scrollTop / e.currentTarget.clientHeight);
          if (i !== atRef.current) onAt(i);
        }}
      >
        {feed.map((card, i) => (
          <div className="slide" key={card.id}>
            {/* Only the pages around the one on screen are drawn; the rest just hold their place. */}
            {Math.abs(i - at) <= 2 && (
              <Slide
                card={card}
                why={whyOf(card.id)}
                raw={rawTint(card, tints[card.id])}
                fav={favs.has(card.id)}
                onTint={onTint}
                onDetails={onDetails}
                onFav={onFav}
              />
            )}
          </div>
        ))}
        {ended && (
          <div className="slide">
            <End filtered={filters > 0} skipped={left > 0} onFilters={onFilters} onClear={onClearFilters} onLists={onLists} onRestart={onRestart} />
          </div>
        )}
      </div>

      <div className="topbar">
        <button className="pill solid" onClick={onFilters}>
          <SlidersHorizontal size={18} weight="bold" aria-hidden="true" />
          <span className="txt">Filters</span>
          {filters > 0 && (
            <b className="badge" aria-label={`${filters} active`}>
              {filters}
            </b>
          )}
        </button>
        <p className="pill solid stat">
          <span className="sr-only">{left} not rated yet</span>
          <span className="tick" aria-hidden="true">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.b key={left} initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -8, opacity: 0 }} transition={{ duration: 0.18 }}>
                {left}
              </motion.b>
            </AnimatePresence>
          </span>
          <span aria-hidden="true">left</span>
        </p>
      </div>

      <nav className="rate-row" aria-label={current ? `Rate ${current.title}` : "Rate this title"}>
        {RATING_NAMES.map((name) => (
          <RateButton key={name} name={name} on={!!current && rated.get(current.id) === name} disabled={!current} onClick={() => press(name)} />
        ))}
      </nav>
    </section>
  );
}
