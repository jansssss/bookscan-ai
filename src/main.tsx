import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import Diagnostics from "./Diagnostics";
import "./style.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {new URLSearchParams(location.search).has("diagnostics") ? (
      <Diagnostics />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
if (
  "serviceWorker" in navigator &&
  import.meta.env.PROD &&
  !window.BookScanNative
)
  navigator.serviceWorker
    .register(
      new URL("sw.js", new URL(import.meta.env.BASE_URL, location.href)).href,
    )
    .catch(console.error);
