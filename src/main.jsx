import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

// iPhone can size a full-height page taller than the part you can actually see (Safari's toolbar, or a band the
// keyboard leaves behind in a home-screen app), which cuts off the tab bar at the bottom. So the app is sized to
// what is visible (--app-h); styles.css falls back to 100% without it.
// ponytail: could not be reproduced off the phone. If the bar is still cut off, find out which mode first
// (Safari tab or home screen, right at launch or after scrolling or typing) before changing this.
const view = window.visualViewport;
let width = window.innerWidth;
const fit = () => {
  // Keyboard is up: leave the app at full height behind it. A rotation still gets through (the width changes).
  if (window.innerWidth === width && document.activeElement?.matches?.("input, textarea")) return;
  width = window.innerWidth;
  const height = view && view.scale <= 1.01 ? view.height : window.innerHeight;
  document.documentElement.style.setProperty("--app-h", `${Math.floor(height)}px`);
  if (window.scrollY) window.scrollTo(0, 0); // undo any page scroll the browser slipped in
};
fit();
view?.addEventListener("resize", fit);
window.addEventListener("resize", fit);
window.addEventListener("orientationchange", () => setTimeout(fit, 300));
window.addEventListener("pageshow", fit);
document.addEventListener("focusout", () => setTimeout(fit, 300)); // after the keyboard goes away

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
