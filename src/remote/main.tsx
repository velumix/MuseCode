import React from "react";
import ReactDOM from "react-dom/client";
import RemoteApp from "./RemoteApp";
import "../App.css";
import "./remote.css";

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><RemoteApp /></React.StrictMode>);
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  // Activate fresh assets on the next navigation without discarding a draft.
  void navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).catch(() => {});
}
