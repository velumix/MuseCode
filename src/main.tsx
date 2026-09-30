import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initializeDesktop } from "./desktopHistory";
import { initializePreferences } from "./preferences";

void Promise.all([initializeDesktop(), initializePreferences(true)]).finally(() => ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
));
