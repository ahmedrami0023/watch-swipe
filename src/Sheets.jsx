// Bottom sheets: title details and deck filters. Built on the native <dialog> (focus trap, Escape, inert page).
import { useEffect, useId, useRef, useState } from "react";
import { animate, motion, useDragControls, useMotionValue } from "motion/react";
import { Play } from "@phosphor-icons/react";
import { Poster } from "./Deck.jsx";
import { BUILT, CARDS, LOGOS } from "./cards.js";
import { DECADES, FAV, GENRES, KINDS, NO_FILTERS, RATINGS, RATING_NAMES, SCORES, SERVICES, filterCount, imageUrl, matches, tmdbPage } from "./ratings.js";

const BY_ID = new Map(CARDS.map((c) => [c.id, c]));

// Slides up, drags down to dismiss (from its header, or from anywhere once the content is scrolled to the top),
// and plays its exit before the dialog really closes.
// The slide and the drag live on separate elements: on one element the drag limits fought the slide-in and made it jump.
function Sheet({ title, onClose, children, footer }) {
  const dialog = useRef(null);
  const body = useRef(null);
  const y = useMotionValue(0);
  const closeNow = useRef(null);
  const controls = useDragControls();
  const [open, setOpen] = useState(true);
  const done = useRef(false);
  const after = useRef(null); // an action to run once the sheet has really closed
  const titleId = useId();

  useEffect(() => {
    if (!dialog.current.open) dialog.current.showModal(); // guard: dev StrictMode runs effects twice
  }, []);

  const finish = () => {
    if (done.current) return;
    done.current = true;
    dialog.current?.close(); // hands focus back to whatever opened the sheet
    const action = after.current;
    // Acting only now means the page is no longer inert, so the announcement is heard.
    action?.();
    onClose();
    // The control that opened the sheet is about to disappear (card rated, row moved): park focus somewhere stable.
    // Search results stay where they are, so there the row that opened the sheet simply keeps focus.
    // The same goes when the opener already vanished behind the sheet (un-favourited from the Favorites list).
    requestAnimationFrame(() => {
      if ((action || document.activeElement === document.body) && !document.querySelector(".search"))
        document.querySelector('.deck-empty h2, .rate-row button:not(:disabled), .page .chip[aria-pressed="true"]')?.focus();
    });
  };
  const close = (action) => {
    if (typeof action === "function") after.current = action;
    setOpen(false);
    setTimeout(finish, 450); // safety net if the exit animation is skipped (reduced motion)
  };
  closeNow.current = close;

  // Pulling down on the content closes the sheet, but only when the content is already at its top:
  // otherwise the same finger movement just scrolls back up. Touch events, because the browser takes
  // pointer events away as soon as it thinks a scroll has started.
  useEffect(() => {
    const el = body.current;
    let start = null;
    let pulling = false;
    const down = (e) => {
      pulling = false;
      start = el.scrollTop <= 0 && e.touches.length === 1 && !e.target.closest(".viewer") ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: e.timeStamp } : null;
    };
    const move = (e) => {
      if (!start) return;
      const dx = e.touches[0].clientX - start.x;
      const dy = e.touches[0].clientY - start.y;
      if (!pulling) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        if (dy <= 0 || Math.abs(dx) > dy) return void (start = null); // scrolling down the page, or sideways through a row
        pulling = true;
      }
      if (e.cancelable) e.preventDefault();
      y.set(Math.max(0, dy - 8));
    };
    const up = (e) => {
      if (pulling) {
        const speed = (y.get() / Math.max(1, e.timeStamp - start.t)) * 1000;
        if (y.get() > 120 || (y.get() > 40 && speed > 600)) closeNow.current();
        else animate(y, 0, { type: "spring", bounce: 0, visualDuration: 0.25 });
      }
      start = null;
      pulling = false;
    };
    el.addEventListener("touchstart", down, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", up);
    el.addEventListener("touchcancel", up);
    return () => {
      el.removeEventListener("touchstart", down);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", up);
      el.removeEventListener("touchcancel", up);
    };
  }, [y]);

  return (
    <dialog
      className="sheet-dialog"
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault(); // Escape: play the exit first
        close();
      }}
    >
      {/* Our own dimmer, so it fades in and out in step with the sheet (the built-in backdrop can only pop). */}
      <motion.div className="dimmer" initial={{ opacity: 0 }} animate={{ opacity: open ? 1 : 0 }} transition={{ duration: 0.25 }} onClick={() => close()} />
      <motion.div
        className="sheet-slide"
        initial={{ y: window.innerHeight }}
        animate={{ y: open ? 0 : window.innerHeight }}
        transition={{ type: "spring", bounce: 0, visualDuration: open ? 0.38 : 0.26 }}
        onAnimationComplete={() => !open && finish()}
      >
      <motion.div
        className="sheet"
        style={{ y }}
        drag="y"
        dragControls={controls}
        dragListener={false}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.6 }}
        onDragEnd={(_, info) => (info.offset.y > 120 || info.velocity.y > 500) && close()}
      >
        <header className="sheet-head" onPointerDown={(e) => !e.target.closest("button") && controls.start(e)}>
          <span className="grab" aria-hidden="true" />
          <h2 id={titleId} className="sheet-title">{title}</h2>
          <button className="pill solid" onClick={() => close()}>
            Close
          </button>
        </header>
        <div className="sheet-body" ref={body}>{typeof children === "function" ? children(close) : children}</div>
        {footer && <footer className="sheet-foot">{footer(close)}</footer>}
      </motion.div>
      </motion.div>
    </dialog>
  );
}

// The trailer loads from YouTube only when asked for; until then it is just a picture with a play button.
function Trailer({ id, title }) {
  const [playing, setPlaying] = useState(false);
  return (
    <div className="trailer">
      {playing ? (
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1`}
          title={`Trailer for ${title}`}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
        />
      ) : (
        <button onClick={() => setPlaying(true)} aria-label={`Play the trailer for ${title}`}>
          <img src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`} alt="" loading="lazy" />
          <span className="play">
            <Play size={26} weight="fill" aria-hidden="true" />
          </span>
        </button>
      )}
    </div>
  );
}

// Photos full screen: swipe sideways for the next one, tap anywhere (or Escape) to go back.
function Viewer({ photos, start, title, onClose }) {
  const dialog = useRef(null);
  const strip = useRef(null);
  useEffect(() => {
    if (!dialog.current.open) dialog.current.showModal();
    strip.current.scrollLeft = start * strip.current.clientWidth;
  }, [start]);
  return (
    <dialog className="viewer" ref={dialog} aria-label={`Photos of ${title}`} onClose={onClose} onClick={() => dialog.current.close()}>
      <div className="viewer-strip" ref={strip}>
        {photos.map((path, k) => (
          <img key={path} src={imageUrl(path, "w1280")} alt={`Photo ${k + 1} of ${photos.length}`} draggable="false" />
        ))}
      </div>
      <button className="pill solid viewer-close">Close</button>
    </dialog>
  );
}

const day = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

// What comes next for a show, worked out today from the air dates in its file (so it stays right between rebuilds
// for everything that was already scheduled).
function upNext(data, today) {
  const ahead = data.seasons
    .flatMap((s) => s.eps.map(([n, name, date]) => ({ s: s.n, n, name, date })))
    .filter((e) => e.date && e.date >= today)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))[0];
  if (ahead) {
    const when = ahead.date === today ? "today" : day(ahead.date);
    if (ahead.n === 1) return `Season ${ahead.s} starts ${when}.`;
    return `Next episode: season ${ahead.s}, episode ${ahead.n}, ${when}.`;
  }
  const season = data.seasons.find((s) => s.date && s.date >= today);
  if (season) return `Season ${season.n} starts ${day(season.date)}.`;
  if (data.status === "Ended" || data.status === "Canceled") return null;
  return `No date yet for the next episode (checked ${day(data.built)}).`;
}

// Seasons and episodes for a show: one small file per show, fetched when its details open.
function Episodes({ id }) {
  const [data, setData] = useState(null); // null while loading, false if it could not be read
  const [open, setOpen] = useState(() => new Set()); // episode rows are only built for seasons that are open
  useEffect(() => {
    let live = true;
    fetch(`${import.meta.env.BASE_URL}episodes/${id}.json`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then(
        (d) => live && setData(d),
        () => live && setData(false),
      );
    return () => {
      live = false;
    };
  }, [id]);

  if (data === null) return <p className="quiet" role="status">Loading episodes…</p>;
  if (!data || !Array.isArray(data.seasons)) return <p className="quiet" role="status">Episodes could not be loaded. Check the connection and open this again.</p>;
  const today = new Date().toLocaleDateString("en-CA");
  const state = data.status === "Ended" ? "Finished" : data.status === "Canceled" ? "Cancelled" : "Ongoing";
  const next = upNext(data, today);
  return (
    <>
      <p className="scores">
        <span className="pill solid stat">
          <b>{state}</b>
        </span>
      </p>
      {next && <p className="summary">{next}</p>}
      {data.seasons.map((s) => (
        <details
          key={s.n}
          className="season"
          onToggle={(e) => {
            const on = e.currentTarget.open; // read now: React clears the event before the updater runs
            setOpen((was) => {
              const now = new Set(was);
              if (on) now.add(s.n);
              else now.delete(s.n);
              return now;
            });
          }}
        >
          <summary>
            <span>
              Season {s.n}
              {s.name && `: ${s.name}`}
              <small>
                {[s.date ? (s.date > today ? `Starts ${day(s.date)}` : s.date.slice(0, 4)) : "No date yet", `${s.eps.length} episode${s.eps.length === 1 ? "" : "s"}`].join(" · ")}
              </small>
            </span>
            {s.rating != null && <b className="score">{s.rating.toFixed(1)}</b>}
          </summary>
          {open.has(s.n) && (
            <ol>
              {s.eps.map(([n, name, date, rating]) => (
                <li key={n}>
                  <span className="ep-n">{n}</span>
                  <span>{name || `Episode ${n}`}</span>
                  {rating != null && <b className="score">{rating.toFixed(1)}</b>}
                  <small>{date ? (date > today ? `Coming ${day(date)}` : day(date)) : "No date yet"}</small>
                </li>
              ))}
            </ol>
          )}
        </details>
      ))}
      <p className="quiet small">Scores are TMDB user ratings. Checked {day(data.built)}.</p>
    </>
  );
}

export function Details({ card, rating, fav, onPick, onFav, onRemove, onOpen, onClose }) {
  const [zoom, setZoom] = useState(null); // which photo is open full screen
  const photos = [card.backdrop, ...(card.shots ?? [])].filter(Boolean);
  const similar = card.recs.map((id) => BY_ID.get(id)).filter(Boolean).slice(0, 12);
  // Opening a similar title swaps what the sheet shows, so start it from the top again.
  useEffect(() => {
    document.querySelector(".sheet-body")?.scrollTo(0, 0);
  }, [card.id]);
  return (
    <Sheet title={card.title} onClose={onClose}>
      {(close) => (
        <>
          {/* The whole poster, uncropped. Same file the card already loaded, so it is on screen at once. */}
          <div className="hero">
            <Poster card={card} className="art" alt={`Poster for ${card.title}`} />
          </div>
          <p className="kind">
            {card.type} · {card.year}
          </p>
          {card.genres.length > 0 && <p className="quiet">{card.genres.join(", ")}</p>}
          {card.facts.length > 0 && <p className="quiet">{card.facts.join(", ")}</p>}
          {card.by && (
            <p className="quiet">
              {card.by.label} {card.by.names.join(", ")}
            </p>
          )}
          {card.rating != null && (
            <p className="scores">
              <span className="pill solid stat">
                TMDB <b>{card.rating.toFixed(1)}</b>
              </span>
            </p>
          )}

          <h3>{rating ? "Your rating" : "Rate it"}</h3>
          <div className="chips wrap">
            {RATING_NAMES.map((name) => {
              const { Icon, short, label, solid } = RATINGS[name];
              return (
                <button
                  key={name}
                  className="chip"
                  data-rating={name}
                  aria-pressed={rating === name}
                  aria-label={`${short}: ${label}`}
                  onClick={() => close(rating !== name ? () => onPick(card.id, name) : undefined)}
                >
                  <Icon size={18} weight={rating === name ? solid : "bold"} aria-hidden="true" />
                  {short}
                </button>
              );
            })}
            {/* A favourite on an unrated title also marks it seen and liked, so it closes like a rating does. */}
            <button
              className="chip"
              data-rating="fav"
              aria-pressed={fav}
              onClick={() => (rating ? onFav(card.id) : close(() => onFav(card.id)))}
            >
              <FAV.Icon size={18} weight={fav ? "fill" : "bold"} aria-hidden="true" />
              {FAV.label}
            </button>
          </div>
          {rating && (
            <button
              className="btn"
              onClick={() => close(() => onRemove(card.id))}
            >
              Remove rating
            </button>
          )}

          {card.trailer && (
            <>
              <h3>Trailer</h3>
              <Trailer key={card.trailer} id={card.trailer} title={card.title} />
            </>
          )}
          {photos.length > 0 && (
            <>
              <h3>Photos</h3>
              <div className="rail">
                {photos.map((path, k) => (
                  <button key={path} className="shot" onClick={() => setZoom(k)} aria-label={`Photo ${k + 1} of ${photos.length}, open full screen`}>
                    <img src={imageUrl(path, "w780")} alt="" loading="lazy" draggable="false" />
                  </button>
                ))}
              </div>
              {zoom !== null && <Viewer photos={photos} start={zoom} title={card.title} onClose={() => setZoom(null)} />}
            </>
          )}
          {card.summary && (
            <>
              <h3>About</h3>
              <p className="summary">{card.summary}</p>
            </>
          )}
          {card.cast.length > 0 && (
            <>
              <h3>Cast</h3>
              <p className="summary">{card.cast.join(", ")}</p>
            </>
          )}
          {card.id.startsWith("t-") && (
            <>
              <h3>Seasons and episodes</h3>
              <Episodes key={card.id} id={card.id} />
            </>
          )}
          <h3>Streaming in the US</h3>
          {card.providers.length > 0 ? (
            <p className="services">
              {card.providers.map((name) => (
                <span key={name} className="pill solid stat">
                  {LOGOS[name] && <img className="logo" src={imageUrl(LOGOS[name], "w92")} alt="" loading="lazy" />}
                  {name}
                </span>
              ))}
            </p>
          ) : (
            <p className="quiet">Not on a subscription service as of {BUILT}.</p>
          )}
          {similar.length > 0 && (
            <>
              <h3>More like this</h3>
              <div className="rail">
                {similar.map((other) => (
                  <button key={other.id} className="like" onClick={() => onOpen(other.id)}>
                    <span className="like-art">
                      <Poster card={other} size="w342" className="art" />
                    </span>
                    <span className="like-title">{other.title}</span>
                    <small>
                      {other.type} · {other.year}
                    </small>
                  </button>
                ))}
              </div>
            </>
          )}
          <p className="credit">
            Details from{" "}
            <a href={tmdbPage(card)} target="_blank" rel="noreferrer">
              TMDB
            </a>
            .{" "}
            {card.watch && (
              <>
                Streaming data from{" "}
                <a href={card.watch} target="_blank" rel="noreferrer">
                  JustWatch
                </a>
                , as of {BUILT}.
              </>
            )}
          </p>
        </>
      )}
    </Sheet>
  );
}

function ChipGroup({ label, options, isOn, onToggle }) {
  return (
    <fieldset className="group">
      <legend>{label}</legend>
      <div className="chips wrap">
        {options.map(([value, text]) => (
          <button key={value ?? "any"} className="chip" aria-pressed={isOn(value)} onClick={() => onToggle(value)}>
            {text}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

// Changes are a draft until "Show" is pressed; closing any other way discards them.
export function Filters({ filters, unrated, onApply, onClose }) {
  const [draft, setDraft] = useState(filters);
  const toggle = (field) => (value) =>
    setDraft((d) => ({ ...d, [field]: d[field].includes(value) ? d[field].filter((v) => v !== value) : [...d[field], value] }));
  const count = unrated.filter((card) => matches(card, draft)).length;

  return (
    <Sheet
      title="Filters"
      onClose={onClose}
      footer={(close) => (
        <>
          <button className="btn" onClick={() => setDraft(NO_FILTERS)} aria-disabled={!filterCount(draft)}>
            Reset
          </button>
          <button
            className="btn primary"
            disabled={!count}
            onClick={() => close(() => onApply(draft))}
          >
            {count ? `Show ${count}` : "No matches"}
          </button>
        </>
      )}
    >
      <ChipGroup label="Type" options={Object.entries(KINDS)} isOn={(v) => draft.kinds.includes(v)} onToggle={toggle("kinds")} />
      <ChipGroup label="Genre" options={GENRES.map((g) => [g, g])} isOn={(v) => draft.genres.includes(v)} onToggle={toggle("genres")} />
      <ChipGroup
        label="Decade"
        options={[[null, "Any"], ...DECADES.map((d) => [d, d])]}
        isOn={(v) => draft.decade === v}
        onToggle={(v) => setDraft((d) => ({ ...d, decade: v }))}
      />
      <ChipGroup
        label="TMDB score"
        options={[[null, "Any"], ...SCORES.map((s) => [s, `${s}+`])]}
        isOn={(v) => draft.min === v}
        onToggle={(v) => setDraft((d) => ({ ...d, min: v }))}
      />
      <ChipGroup label="Streaming on" options={SERVICES.map((s) => [s, s])} isOn={(v) => draft.services.includes(v)} onToggle={toggle("services")} />
      {!count && <p className="quiet">Nothing fits. Loosen a filter.</p>}
    </Sheet>
  );
}
