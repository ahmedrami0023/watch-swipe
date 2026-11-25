// The two scrolling tabs: Lists (everything you rated) and You (taste summary + settings).
import { useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Poster } from "./Deck.jsx";
import { BUILT, CARDS } from "./cards.js";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { BY_ID, FAV, RAIL, RATINGS, RATING_NAMES, clean, search } from "./ratings.js";

const LIST_ORDER = ["fav", "want", "liked", "disliked", "pass", "unsure"];
const inList = (s, list) => (list === "fav" ? s.fav === true : s.rating === list);

// One title in a list: poster, name, and small marks for its rating and favourite.
function TitleRow({ card, rating, fav, onOpen }) {
  const Mark = rating && RATINGS[rating].Icon;
  return (
    <button className="row" onClick={() => onOpen(card.id)}>
      <Poster card={card} size="w154" className="thumb" />
      <span>
        <strong>{card.title}</strong>
        <small>
          {card.type} · {card.year}
        </small>
      </span>
      <span className="marks">
        {fav && <FAV.Icon size={18} weight="fill" data-rating="fav" role="img" aria-label="Favorite" />}
        {Mark && <Mark size={18} weight={RATINGS[rating].solid} data-rating={rating} role="img" aria-label={RATINGS[rating].list} />}
      </span>
    </button>
  );
}

const EMPTY = {
  fav: "No favorites yet. Tap the heart on a title you love.",
  want: "Nothing saved yet. Tap Want on something.",
  liked: "Tap Liked on something you enjoyed.",
  disliked: "Tap Disliked on ones that missed.",
  unsure: "Nothing here.",
  pass: "Titles you scroll past land here. Open one and rate it to change that.",
};

export function Lists({ swipes, onOpen }) {
  const [picked, setWhich] = useState("want");
  // "Not sure" has no button any more, so its list goes away once it is empty: fall back to Want then.
  const which = picked === "unsure" && !swipes.some((s) => s.rating === "unsure") ? "want" : picked;
  const rows = swipes.filter((s) => inList(s, which)).sort((a, b) => b.at - a.at);
  return (
    <section className="page">
      <h1>Lists</h1>
      <div className="chips scroll" role="group" aria-label="Pick a list">
        {/* "Not sure" has no button any more; its list only shows while it still holds something. */}
        {LIST_ORDER.filter((name) => name !== "unsure" || swipes.some((s) => s.rating === "unsure")).map((name) => (
          <button key={name} className="chip" data-rating={name} aria-pressed={which === name} onClick={() => setWhich(name)}>
            {(RATINGS[name] ?? FAV).list} <b>{swipes.filter((s) => inList(s, name)).length}</b>
          </button>
        ))}
      </div>
      {rows.length === 0 && <p className="quiet empty">{EMPTY[which]}</p>}
      <ul className="rows" key={which}>
        <AnimatePresence initial={false} mode="popLayout">
          {rows.map(({ id, rating, fav }) => (
            <motion.li key={id} layout={rows.length <= 60} exit={{ opacity: 0, x: -40 }} transition={{ duration: 0.2 }}>
              <TitleRow card={BY_ID.get(id)} rating={which === "fav" ? rating : null} fav={which !== "fav" && fav} onOpen={onOpen} />
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </section>
  );
}

// Look a title up directly instead of waiting for it in the deck.
export function Search({ swipes, onOpen }) {
  const [query, setQuery] = useState("");
  const found = search(query, 61); // one extra, to know when there are more than we show
  const results = found.slice(0, 60);
  const mine = new Map(swipes.map((s) => [s.id, s]));
  const asked = query.trim().length >= 2;
  return (
    <section className="page">
      <h1>Search</h1>
      {/* A form so the keyboard's Search key works: it puts the keyboard away. */}
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          e.currentTarget.querySelector("input").blur();
        }}
      >
      <label className="search">
        <MagnifyingGlass size={20} weight="bold" aria-hidden="true" />
        <span className="sr-only">Search titles, cast or director</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Title, actor or director"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
        />
      </label>
      </form>
      <p className="quiet empty" role="status">
        {!asked
          ? `Look up any of the ${CARDS.length.toLocaleString()} titles to rate it, favorite it or see its details.`
          : results.length === 0
            ? "Nothing by that name in the catalogue yet."
            : `${found.length > 60 ? "First 60" : results.length} match${results.length === 1 ? "" : "es"}`}
      </p>
      <ul className="rows">
        {results.map((card) => (
          <li key={card.id}>
            <TitleRow card={card} rating={mine.get(card.id)?.rating} fav={mine.get(card.id)?.fav} onOpen={onOpen} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function You({ swipes, onImport, onReset }) {
  const [message, setMessage] = useState("");
  const file = useRef(null);
  const confirm = useRef(null);
  const counts = Object.fromEntries(RATING_NAMES.map((r) => [r, swipes.filter((s) => s.rating === r).length]));
  const names = RATING_NAMES.filter((r) => r !== "unsure" || counts.unsure); // "Not sure" only while some are saved
  const tapped = swipes.filter((s) => !s.auto).length; // ratings given by hand, not by scrolling past

  // Genres from titles you liked or want, most common first.
  const tally = {};
  for (const s of swipes) if (s.rating === "liked" || s.rating === "want") for (const g of BY_ID.get(s.id).genres.flatMap((pair) => pair.split(" & "))) tally[g] = (tally[g] || 0) + 1;
  const topGenres = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 3);

  // On iPhone the share sheet ("Save to Files") is the reliable way out of a home-screen app; elsewhere, a download.
  const exportFile = async () => {
    const name = `watch-swipe-${new Date().toISOString().slice(0, 10)}.json`;
    const json = JSON.stringify({ app: "watch-swipe", version: 2, exported: new Date().toISOString(), swipes }, null, 2);
    const shareable = new File([json], name, { type: "application/json" });
    if (navigator.canShare?.({ files: [shareable] })) {
      try {
        await navigator.share({ files: [shareable] });
        setMessage(`Exported ${swipes.length} ratings.`);
      } catch {
        setMessage("Export cancelled. Nothing was saved.");
      }
      return;
    }
    const link = document.createElement("a");
    link.href = URL.createObjectURL(shareable);
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 60000); // iOS asks before downloading, so keep the file alive
    setMessage(`Exported ${swipes.length} ratings.`);
  };
  const askErase = () => {
    confirm.current.showModal();
    confirm.current.querySelector(".btn.primary").focus(); // start on the safe choice
  };

  const importFile = async (e) => {
    const picked = e.target.files?.[0];
    e.target.value = ""; // so the same file can be picked again
    if (!picked) return;
    try {
      const parsed = JSON.parse(await picked.text());
      const raw = Array.isArray(parsed) ? parsed : parsed?.swipes;
      if (!Array.isArray(raw)) throw new Error("no swipes");
      const valid = clean(raw);
      const have = new Set(swipes.map((s) => s.id));
      const fresh = valid.filter((s) => !have.has(s.id));
      onImport(fresh);
      setMessage(`Added ${fresh.length}, skipped ${raw.length - fresh.length}.`);
    } catch {
      setMessage("That file isn't a Watch Swipe export. Nothing was changed.");
    }
  };

  return (
    <section className="page">
      <h1>You</h1>

      <div className="panel">
        <h2>Your taste</h2>
        {tapped < 10 ? (
          <p className="quiet">Rate 10 titles to see your taste. You're at {tapped}.</p>
        ) : (
          <>
            <div className="bar" role="img" aria-label={names.map((r) => `${RATINGS[r].list} ${counts[r]}`).join(", ")}>
              {names.filter((r) => counts[r]).map((r) => (
                <span key={r} data-rating={r} style={{ flexGrow: counts[r] }} />
              ))}
            </div>
            <ul className="legend">
              {names.map((r) => {
                const { Icon, list, solid } = RATINGS[r];
                return (
                  <li key={r} data-rating={r}>
                    <Icon size={16} weight={solid} aria-hidden="true" />
                    {list} <b>{counts[r]}</b>
                  </li>
                );
              })}
            </ul>
            {topGenres.length > 0 && (
              <p className="quiet">
                Most liked or wanted: {topGenres.map(([g, n]) => `${g} (${n})`).join(", ")}
              </p>
            )}
          </>
        )}
        <p className="quiet">
          Seen {swipes.length} of {CARDS.length}, rated {tapped}. The feed starts with a broad mix to learn your taste, then narrows step by step, and
          keeps mixing in things you have not tried.
        </p>
      </div>

      <div className="panel">
        <h2>How it works</h2>
        <ul className="how">
          <li data-rating="pass">
            <RATINGS.pass.Icon size={18} weight="bold" aria-hidden="true" />
            <b>Scroll past</b>
            <span>Not interested. It won't come back</span>
          </li>
          {RAIL.map((r) => {
            const { Icon, short, label, solid } = RATINGS[r];
            return (
              <li key={r} data-rating={r}>
                <Icon size={18} weight={solid} aria-hidden="true" />
                <b>{short}</b>
                <span>{label}. Tap again to undo</span>
              </li>
            );
          })}
          <li data-rating="fav">
            <FAV.Icon size={18} weight="fill" aria-hidden="true" />
            <b>Heart</b>
            <span>Favorite: seen it and loved it</span>
          </li>
          <li>
            <span className="dotless" aria-hidden="true" />
            <b>Tap</b>
            <span>Open details</span>
          </li>
        </ul>
      </div>

      <div className="panel">
        <h2>Your data</h2>
        <p className="quiet">Ratings live only on this device, and the home-screen app keeps its own copy, separate from Safari. Export one now and then.</p>
        <div className="actions">
          <button className="btn primary" onClick={() => swipes.length && exportFile()} aria-disabled={!swipes.length}>
            Export ratings
          </button>
          <button className="btn" onClick={() => file.current.click()}>
            Import ratings
          </button>
          <button className="btn danger" onClick={() => swipes.length && askErase()} aria-disabled={!swipes.length}>
            Erase all
          </button>
        </div>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={importFile} />
        <p className="quiet" role="status">
          {message}
        </p>
      </div>

      <div className="panel">
        <h2>Credits</h2>
        <p className="quiet">
          This product uses the <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer">TMDB</a> API but is not endorsed or certified by TMDB. Posters, details and scores
          come from TMDB.
        </p>
        <p className="quiet">
          Streaming availability comes from <a href="https://www.justwatch.com" target="_blank" rel="noreferrer">JustWatch</a>.
        </p>
        <p className="quiet">
          {CARDS.length} titles, updated {BUILT}.
        </p>
      </div>

      <dialog className="confirm" ref={confirm} aria-labelledby="erase-title">
        <h2 id="erase-title">Erase all {swipes.length} ratings?</h2>
        <p className="quiet">This can't be undone. Export a copy first if you might want them back.</p>
        <div className="actions">
          <button className="btn" onClick={exportFile}>
            Export first
          </button>
          <button
            className="btn danger"
            onClick={() => {
              onReset();
              confirm.current.close();
              setMessage("All ratings erased.");
            }}
          >
            Erase
          </button>
          <button className="btn primary" onClick={() => confirm.current.close()}>
            Cancel
          </button>
        </div>
      </dialog>
    </section>
  );
}
