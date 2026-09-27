import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initializeDesktop } from "./desktopHistory";

void initializeDesktop().finally(() => ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
));
