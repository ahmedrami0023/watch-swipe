// The feed: one full-screen title per page, scrolled like short videos. The buttons on the right rate the title
// on screen; scrolling past a title without rating it means "not interested".
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Info, SlidersHorizontal, X } from "@phosphor-icons/react";
import { FAV, RAIL, RATINGS, SCORE_WORDS, imageUrl, rawTint, sample, scoreTier } from "./ratings.js";

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

// A TMDB score, coloured by how good it is (red to green). The number is always there, so colour is never the only cue.
export function ScorePill({ value }) {
  const tier = scoreTier(value);
  return (
    <span className="score-pill" data-score={tier}>
      TMDB <b>{value.toFixed(1)}</b>
      <span className="sr-only">, {SCORE_WORDS[tier]}</span>
    </span>
  );
}

// One title. The whole poster sits on top, uncropped; the caption sits under it, so words never cover the picture.
// Tapping the page opens its details (the Details button on the right does the same for keyboards).
function Slide({ card, why, passed, raw, onTint, onDetails }) {
  return (
    <article className="card tinted" aria-label={`${card.title}, ${card.type}, ${card.year}`} style={{ "--raw": raw }} onClick={() => onDetails(card.id)}>
      <Poster card={card} className="art" onTint={onTint} />
      <div className="scrim" />
      <div className="info">
        {passed ? (
          <p className="passed">
            <X size={12} weight="bold" aria-hidden="true" />
            Not interested
          </p>
        ) : (
          why && <p className="why">{why}</p>
        )}
        <h2>{card.title}</h2>
        <p className="meta">
          <span>{[card.type, card.year, card.genres[0]].filter(Boolean).join(" · ")}</span>
          {card.rating != null && <ScorePill value={card.rating} />}
        </p>
        {card.summary && <p className="blurb">{card.summary}</p>}
      </div>
    </article>
  );
}

function RailButton({ name, label, hint, Icon, solid = "fill", on, onClick }) {
  return (
    <motion.button
      className="rate"
      data-rating={name}
      aria-pressed={on}
      aria-label={hint}
      onClick={onClick}
      whileTap={{ scale: 0.88 }}
      transition={{ type: "spring", bounce: 0.4, visualDuration: 0.18 }}
    >
      <span className="disc">
        <Icon size={24} weight={on ? solid : "bold"} aria-hidden="true" />
      </span>
      <span aria-hidden="true">{label}</span>
    </motion.button>
  );
}

function End({ filtered, onFilters, onClear, onLists }) {
  return (
    <section className="deck-empty">
      <h2 tabIndex={-1}>{filtered ? "Nothing left here" : "That's everything"}</h2>
      <p>{filtered ? "You've been through every title that fits these filters." : "You've been through every title."}</p>
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
        <button className={filtered ? "btn" : "btn primary"} onClick={onLists}>
          Open lists
        </button>
      </div>
    </section>
  );
}

// feed: the titles shown so far this session plus the next few, in order. at: which page is on screen.
// ended: nothing more to add, so a closing page follows the last title.
export default function Deck({ feed, at, ended, left, rated, favs, tints, whyOf, reduce, filters, onAt, onRate, onPass, onDetails, onFav, onTint, onFilters, onClearFilters, onLists }) {
  const scroller = useRef(null);
  const current = feed[at];
  const pages = feed.length + (ended ? 1 : 0);
  const fav = !!current && favs.has(current.id);

  // Coming back from another tab: return to the page you were on.
  useLayoutEffect(() => {
    scroller.current.scrollTop = scroller.current.children[at]?.offsetTop ?? 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const go = (i) => {
    const el = scroller.current;
    if (el && i >= 0 && i < pages) el.scrollTo({ top: el.children[i].offsetTop, behavior: reduce ? "auto" : "smooth" });
  };
  const goRef = useRef(go);
  goRef.current = go;
  const atRef = useRef(at);
  atRef.current = at;
  const feedRef = useRef(feed);
  feedRef.current = feed;

  // Scrolling past a title without rating it means "not interested". It counts once the feed has come to rest
  // on a later page (so a half-drag you pull back from does nothing), and never when you scroll back up.
  const rested = useRef(at); // the page the feed last came to rest on
  const idle = useRef(0);
  const settle = () => {
    const el = scroller.current;
    if (!el?.clientHeight) return;
    const i = Math.round(el.scrollTop / el.clientHeight);
    const page = el.children[i];
    if (!page || Math.abs(page.getBoundingClientRect().top - el.getBoundingClientRect().top) > 2) return; // still between pages
    if (i > rested.current) onPass(feedRef.current.slice(rested.current, i).map((card) => card.id));
    rested.current = i;
  };
  const settleRef = useRef(settle);
  settleRef.current = settle;
  useEffect(() => () => clearTimeout(idle.current), []);

  // When the screen changes height (browser toolbars, rotation), stay on the same page.
  useEffect(() => {
    const el = scroller.current;
    const watcher = new ResizeObserver(() => {
      const page = el.children[atRef.current];
      if (page && Math.abs(el.scrollTop - page.offsetTop) > 1) el.scrollTop = page.offsetTop;
    });
    watcher.observe(el);
    return () => watcher.disconnect();
  }, []);

  // Up and down arrows (and Page Up/Down) move through the feed when no sheet is open.
  useEffect(() => {
    const onKey = (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey || document.querySelector("dialog[open]") || e.target.closest?.("input, textarea")) return;
      // End and Home move one page too: left to the browser, End would jump to the last page and mark everything between as scrolled past.
      const step = { ArrowDown: 1, PageDown: 1, End: 1, ArrowUp: -1, PageUp: -1, Home: -1 }[e.key];
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
          clearTimeout(idle.current);
          idle.current = setTimeout(() => settleRef.current(), 140);
        }}
      >
        {feed.map((card, i) => (
          // Pages off screen are inert: a screen reader stepping into the next one would scroll the feed and so mark this one "not interested".
          <div className="slide" key={card.id} inert={i !== at || undefined}>
            {/* Only the pages around the one on screen are drawn; the rest just hold their place. */}
            {Math.abs(i - at) <= 2 && (
              <Slide card={card} why={whyOf(card.id)} passed={rated.get(card.id) === "pass"} raw={rawTint(card, tints[card.id])} onTint={onTint} onDetails={onDetails} />
            )}
          </div>
        ))}
        {ended && (
          <div className="slide" inert={at !== feed.length || undefined}>
            <End filtered={filters > 0} onFilters={onFilters} onClear={onClearFilters} onLists={onLists} />
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
          <span className="sr-only">{left} left to see</span>
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

      {/* The buttons act on the title on screen. The ones used most sit lowest, nearest the thumb. */}
      {current && (
        <nav className="acts" aria-label={`Rate ${current.title}`}>
          <RailButton name="info" label="Details" hint={`Details for ${current.title}`} Icon={Info} onClick={() => onDetails(current.id)} />
          <RailButton
            name="fav"
            label={FAV.label}
            hint="Favorite: seen it and loved it"
            Icon={FAV.Icon}
            on={fav}
            onClick={(e) => {
              // A keyboard press has no pointer position: burst from the button.
              const box = e.currentTarget.getBoundingClientRect();
              const point = e.detail === 0 ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : { x: e.clientX, y: e.clientY };
              onFav(current.id, fav ? null : point);
            }}
          />
          {RAIL.map((name) => {
            const { Icon, short, label, solid } = RATINGS[name];
            return <RailButton key={name} name={name} label={short} hint={`${short}: ${label}`} Icon={Icon} solid={solid} on={rated.get(current.id) === name} onClick={() => press(name)} />;
          })}
        </nav>
      )}
    </section>
  );
}
