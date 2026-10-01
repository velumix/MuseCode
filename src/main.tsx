import { runStartupUpdates } from "./startupUpdates";

async function bootstrap() {
  if (!await runStartupUpdates()) return;
  const [{ default: React }, { default: ReactDOM }, { default: App }, desktop, preferences] = await Promise.all([
    import("react"), import("react-dom/client"), import("./App"),
    import("./desktopHistory"), import("./preferences"),
  ]);
  await Promise.all([desktop.initializeDesktop(), preferences.initializePreferences(true)]);
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode><App /></React.StrictMode>,
  );
}
void bootstrap();
