// Provider protocol fixture for bots-smoke.mjs. Never invokes a real model.
const fs = require("node:fs");
const provider = process.argv[2],
  args = process.argv.slice(3);
if (!args.includes("exec") && !args.includes("--input-format")) {
  if (provider === "muse") {
    process.argv.splice(2, 1);
    require("./muse-cli.cjs");
  } else require("./provider-cli.cjs");
} else {
  const input =
    provider === "muse"
      ? fs.readFileSync(args[args.indexOf("--prompt-file") + 1], "utf8")
      : fs.readFileSync(0, "utf8");
  const raw =
    provider === "antigravity" ? JSON.parse(input).message.content : input;
  const prompt = raw
    .split("Current request:\n")
    .at(-1)
    .split("</velum-kanban>\n")
    .at(-1);
  fs.appendFileSync(
    process.env.MUSE_QA_LOG,
    JSON.stringify({ provider, args, input: raw, prompt, pid: process.pid }) +
      "\n",
  );
  const emit = (v) => console.log(JSON.stringify(v));
  if (provider === "codex")
    emit({
      type: "thread.started",
      thread_id: "62c2d305-9dd5-4c94-b4c0-667eb612f401",
    });
  if (provider === "antigravity")
    emit({
      event: "init",
      conversation_id: "ae283c22-1851-4d5c-a5c5-d14d53c23b72",
    });
  const complete = () => {
    if (provider === 'antigravity' && prompt.includes('BOT_DENIED')) console.error('Tool required command permission in headless mode and was auto-denied.');
    let answer = "Checked the fixture task and verified the result.";
    const ticket = raw.match(/"ticket":"([^"]+)"/)?.[1],
      revision = Number(raw.match(/Board revision: (\d+)/)?.[1]);
    const card = prompt.match(/Task ID: ([a-f0-9-]+)/)?.[1];
    if (card && !prompt.includes("BOT_NO_ACTION")) {
      let action = {
        action: "update",
        card_id: card,
        column: "review",
        summary: "Verified fixture checks.",
      };
      if (prompt.includes("BOT_CHAIN") && provider !== "antigravity") {
        const team = JSON.parse(
          raw.match(/Available teammates \(metadata only\): (.+)/)[1],
        );
        const next = team.find(
          (b) => b.provider === (provider === "muse" ? "codex" : "antigravity"),
        );
        action = {
          action: "handoff",
          card_id: card,
          to: next.id,
          summary:
            "Verified preceding work. Review the task and continue BOT_CHAIN.",
        };
      }
      answer +=
        "\n```velum-action\n" +
        JSON.stringify({ ticket, revision, actions: [action] }) +
        "\n```";
    }
    if (prompt.includes("BOT_MEMORY"))
      answer +=
        '\n```velum-memory\n[{"title":"Private deployment detail","body":"The bot deployment marker is indigo-fern.","tags":["deployment"]}]\n```';
    if (provider === "muse") {
      for (let i = 0; i < answer.length; i += 7)
        emit({
          payload_type: "run.output.delta",
          payload: { text: answer.slice(i, i + 7) },
        });
      emit({
        payload_type: "run.terminal.completed",
        payload: { terminal: "completed", text: answer },
      });
    } else if (provider === "codex") {
      emit({
        type: "item.completed",
        item: { id: "msg", type: "agent_message", text: answer },
      });
      emit({ type: "turn.completed" });
    } else {
      for (let i = 0; i < answer.length; i += 7)
        emit({
          event: "step_update",
          step_update: {
            step_type: "agent_response",
            text_delta: answer.slice(i, i + 7),
          },
        });
      emit({
        event: "result",
        result: {
          status: "SUCCESS",
          response: answer,
          conversation_id: "ae283c22-1851-4d5c-a5c5-d14d53c23b72",
        },
      });
    }
  };
  if (prompt.includes("BOT_HOLD")) setInterval(() => {}, 1000);
  else if (prompt.includes("BOT_STALE")) setTimeout(complete, 1300);
  else complete();
}
