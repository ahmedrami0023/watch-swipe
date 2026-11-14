// The two scrolling tabs: Lists (everything you rated) and You (taste summary + settings).
import { useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Poster } from "./Deck.jsx";
import { BUILT, CARDS } from "./cards.js";
import { BY_ID, RATINGS, RATING_NAMES, clean } from "./ratings.js";

const LIST_ORDER = ["want", "liked", "disliked", "unsure", "pass"];
const EMPTY = {
  want: "Nothing saved yet. Swipe right on something.",
  liked: "Double-tap a poster you loved.",
  disliked: "Swipe down on ones that missed.",
  unsure: "Swipe up when you can't decide.",
  pass: "Swipe left to skip a title.",
};

export function Lists({ swipes, onOpen }) {
  const [which, setWhich] = useState("want");
  const rows = swipes.filter((s) => s.rating === which).sort((a, b) => b.at - a.at);
  return (
    <section className="page">
      <h1>Lists</h1>
      <div className="chips scroll" role="group" aria-label="Pick a list">
        {LIST_ORDER.map((name) => (
          <button key={name} className="chip" data-rating={name} aria-pressed={which === name} onClick={() => setWhich(name)}>
            {RATINGS[name].list} <b>{swipes.filter((s) => s.rating === name).length}</b>
          </button>
        ))}
      </div>
      {rows.length === 0 && <p className="quiet empty">{EMPTY[which]}</p>}
      <ul className="rows" key={which}>
        <AnimatePresence initial={false} mode="popLayout">
          {rows.map(({ id }) => {
            const card = BY_ID.get(id);
            return (
              <motion.li key={id} layout={rows.length <= 60} exit={{ opacity: 0, x: -40 }} transition={{ duration: 0.2 }}>
                <button className="row" onClick={() => onOpen(id)}>
                  <Poster card={card} size="w154" className="thumb" />
                  <span>
                    <strong>{card.title}</strong>
                    <small>
                      {card.type} · {card.year}
                    </small>
                  </span>
                </button>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
    </section>
  );
}

const HOW = [
  ["Swipe right", "want"],
  ["Swipe left", "pass"],
  ["Swipe up", "unsure"],
  ["Swipe down", "disliked"],
  ["Double-tap", "liked"],
];

export function You({ swipes, onImport, onReset }) {
  const [message, setMessage] = useState("");
  const file = useRef(null);
  const confirm = useRef(null);
  const counts = Object.fromEntries(RATING_NAMES.map((r) => [r, swipes.filter((s) => s.rating === r).length]));

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
        {swipes.length < 10 ? (
          <p className="quiet">Rate 10 titles to see your taste. You're at {swipes.length}.</p>
        ) : (
          <>
            <div className="bar" role="img" aria-label={RATING_NAMES.map((r) => `${RATINGS[r].list} ${counts[r]}`).join(", ")}>
              {RATING_NAMES.filter((r) => counts[r]).map((r) => (
                <span key={r} data-rating={r} style={{ flexGrow: counts[r] }} />
              ))}
            </div>
            <ul className="legend">
              {RATING_NAMES.map((r) => {
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
          Rated {swipes.length} of {CARDS.length}.
        </p>
      </div>

      <div className="panel">
        <h2>How to swipe</h2>
        <ul className="how">
          {HOW.map(([gesture, r]) => {
            const { Icon, label, solid } = RATINGS[r];
            return (
              <li key={r} data-rating={r}>
                <Icon size={18} weight={solid} aria-hidden="true" />
                <b>{gesture}</b>
                <span>{label}</span>
              </li>
            );
          })}
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
