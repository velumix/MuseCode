/** Called after the startup update gate and recovered desktop have finished. */
export function finishStartup(onReady: () => void) {
  const splash = document.getElementById("startup");
  const root = document.getElementById("root");
  if (!splash || !root) return;

  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let leaving = false;
  let removal: ReturnType<typeof setTimeout> | undefined;
  const remove = () => {
    clearTimeout(removal);
    splash.removeEventListener("transitionend", onTransitionEnd);
    splash.remove();
  };
  const onTransitionEnd = (event: TransitionEvent) => {
    if (event.target === splash && event.propertyName === "opacity") remove();
  };
  const detach = () => {
    window.removeEventListener("keydown", skip, true);
    splash.removeEventListener("pointerdown", skip);
    reducedMotion.removeEventListener("change", motionChanged);
  };
  const finish = (immediate = false) => {
    if (leaving) return;
    leaving = true;
    clearTimeout(readyTimer);
    detach();
    root.removeAttribute("inert");
    root.removeAttribute("aria-busy");
    splash.setAttribute("aria-hidden", "true");
    if (immediate || reducedMotion.matches) remove();
    else {
      splash.dataset.leaving = "";
      splash.addEventListener("transitionend", onTransitionEnd);
      // Also remove if the WebView suppresses transition events.
      removal = setTimeout(remove, 240);
    }
    onReady();
  };
  const skip = (event: Event) => {
    if (event instanceof KeyboardEvent && ["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
    // A click/key dismisses the intro; it never activates an obscured control.
    event.preventDefault();
    event.stopImmediatePropagation();
    finish(true);
  };
  const motionChanged = () => { if (reducedMotion.matches) finish(true); };

  // Count from navigation, including history restoration, not from readiness.
  // Cold starts take as long as needed; fast starts get a brief 820 ms reveal.
  const readyTimer = setTimeout(() => finish(), reducedMotion.matches ? 0 : Math.max(0, 820 - performance.now()));
  window.addEventListener("keydown", skip, true);
  splash.addEventListener("pointerdown", skip);
  reducedMotion.addEventListener("change", motionChanged);

  // React StrictMode can subscribe twice. Cancel the first subscription without
  // replaying the CSS animation or exposing the desktop before it is ready.
  return () => {
    clearTimeout(readyTimer);
    detach();
    if (leaving) remove();
  };
}
