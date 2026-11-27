import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./aero-motion.css";

const VALID_THEMES = [
  "frutiger-aero",
  "emerald-3d",
  "tokyo-night",
  "catppuccin",
  "gruvbox",
  "kanagawa",
];

const VALID_MOTIONS = ["full", "subtle", "off"];

// Hydrate persisted aesthetic theme & motion mode before first paint (default: frutiger-aero + full)
try {
  const savedTheme = window.localStorage.getItem("devquest_theme");
  const initialTheme = savedTheme && VALID_THEMES.includes(savedTheme) ? savedTheme : "frutiger-aero";
  document.documentElement.setAttribute("data-theme", initialTheme);

  const savedMotion = window.localStorage.getItem("devquest_motion");
  const prefersReduced =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const initialMotion =
    savedMotion && VALID_MOTIONS.includes(savedMotion)
      ? savedMotion
      : prefersReduced
      ? "off"
      : "full";
  document.documentElement.setAttribute("data-motion", initialMotion);
} catch {
  document.documentElement.setAttribute("data-theme", "frutiger-aero");
  document.documentElement.setAttribute("data-motion", "full");
}

// Register PWA Service Worker
if (typeof window !== "undefined" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Service worker registration is optional (e.g. dev/insecure contexts)
    });
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
