import type { CSSProperties } from "react";
import museMark from "../assets/muse-mark.png";

export type IconName = "search" | "plus" | "chat" | "folder" | "code" | "terminal" | "arrow" | "down" | "reset" | "command" | "check" | "copy" | "close" | "shield" | "bell";

const paths: Record<IconName, string> = {
  search: "M21 21l-4.4-4.4M19 10.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0Z",
  plus: "M12 5v14M5 12h14",
  chat: "M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z",
  folder: "M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm0 2h18",
  code: "m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16",
  terminal: "m5 7 5 5-5 5m8 0h6",
  arrow: "M5 12h14m-5-5 5 5-5 5",
  down: "M12 4v16m-6-6 6 6 6-6",
  reset: "M3 11a9 9 0 1 1 2.6 7.4M3 4v7h7",
  command: "M9 7V5a2 2 0 1 0-2 2h10a2 2 0 1 0-2-2v14a2 2 0 1 0 2-2H7a2 2 0 1 0 2 2V7Z",
  check: "m5 12 4 4L19 6",
  copy: "M9 9h11v12H9V9ZM5 15H3V3h12v2",
  close: "m6 6 12 12M18 6 6 18",
  shield: "m12 3 8 4v5c0 5-8 9-8 9s-8-4-8-9V7l8-4Zm-3 9 2 2 4-4",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Zm-8 12a2 2 0 0 0 4 0",
};

export default function Icon({ name, size = 18, className, style }: { name: IconName; size?: number; className?: string; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className} style={style} aria-hidden="true"><path d={paths[name]} /></svg>;
}

export function MuseMark({ size = 40 }: { size?: number }) {
  return <img className="muse-mark" src={museMark} width={size} height={size} alt="" aria-hidden="true" draggable={false} />;
}
