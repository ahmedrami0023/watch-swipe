// Bottom sheets: title details and deck filters. Built on the native <dialog> (focus trap, Escape, inert page).
import { useEffect, useId, useRef, useState } from "react";
import { motion, useDragControls } from "motion/react";
import { Poster } from "./Deck.jsx";
import { DECADES, GENRES, KINDS, NO_FILTERS, RATINGS, RATING_NAMES, SCORES, SERVICES, filterCount, matches, tmdbPage } from "./ratings.js";

// Slides up, drags down from its header to dismiss, and plays its exit before the dialog really closes.
// The slide and the drag live on separate elements: on one element the drag limits fought the slide-in and made it jump.
function Sheet({ title, onClose, children, footer }) {
  const dialog = useRef(null);
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
    if (action) requestAnimationFrame(() => document.querySelector('.deck-empty h2, .rate-row button:not(:disabled), .page .chip[aria-pressed="true"]')?.focus());
  };
  const close = (action) => {
    if (typeof action === "function") after.current = action;
    setOpen(false);
    setTimeout(finish, 450); // safety net if the exit animation is skipped (reduced motion)
  };

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
        <div className="sheet-body">{typeof children === "function" ? children(close) : children}</div>
        {footer && <footer className="sheet-foot">{footer(close)}</footer>}
      </motion.div>
      </motion.div>
    </dialog>
  );
}

export function Details({ card, rating, onPick, onRemove, onClose }) {
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
          </div>
          {rating && (
            <button
              className="btn"
              onClick={() => close(() => onRemove(card.id))}
            >
              Remove rating
            </button>
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
          <h3>Streaming in the US</h3>
          {card.providers.length > 0 ? (
            <p className="services">
              {card.providers.map((name) => (
                <span key={name} className="pill solid stat">
                  {name}
                </span>
              ))}
            </p>
          ) : (
            <p className="quiet">Not on a subscription service right now.</p>
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
                .
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
