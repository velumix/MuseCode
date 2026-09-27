import type { BotIdentity } from "../bots";
import "./BotAvatar.css";
export default function BotAvatar({
  bot,
  size = 32,
}: {
  bot: Pick<BotIdentity, "name" | "avatar" | "color">;
  size?: number;
}) {
  return (
    <span
      className="bot-avatar"
      style={{
        width: size,
        height: size,
        background: bot.color + "24",
        color: bot.color,
        borderColor: bot.color + "60",
      }}
      aria-hidden="true"
    >
      {bot.avatar ? (
        <img src={bot.avatar} alt="" />
      ) : (
        <span>
          {bot.name
            .trim()
            .split(/\s+/)
            .slice(0, 2)
            .map((s) => s[0])
            .join("")
            .toUpperCase() || "B"}
        </span>
      )}
    </span>
  );
}
