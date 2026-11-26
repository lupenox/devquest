import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

const VALID_THEMES = [
  "emerald-3d",
  "frutiger-aero",
  "tokyo-night",
  "catppuccin",
  "gruvbox",
  "kanagawa",
];

// Hydrate persisted aesthetic theme before first paint (default: emerald-3d)
try {
  const savedTheme = window.localStorage.getItem("devquest_theme");
  const initialTheme = savedTheme && VALID_THEMES.includes(savedTheme) ? savedTheme : "emerald-3d";
  document.documentElement.setAttribute("data-theme", initialTheme);
} catch {
  document.documentElement.setAttribute("data-theme", "emerald-3d");
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
