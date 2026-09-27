/** @type {import('../../packages/plugin-sdk').Plugin} */
const plugin = {
  commands: {
    async "project-brief"(api) {
      const files = await api.workspace.listFiles();
      let details = "";
      if (
        files.some((file) => file.name === "package.json" && !file.directory)
      ) {
        const pkg = JSON.parse(await api.workspace.readText("package.json"));
        details = `\nPackage: ${pkg.name || "unnamed"} (${pkg.version || "unversioned"})\nScripts:\n${Object.entries(
          pkg.scripts || {},
        )
          .map(([name, script]) => `- ${name}: ${script}`)
          .join("\n")}\n`;
      }
      return {
        title: "Project brief",
        text: `Project overview\n${details}\nRoot files:\n${files
          .slice(0, 60)
          .map((f) => `- ${f.name}${f.directory ? "/" : ""}`)
          .join("\n")}`,
      };
    },
    async "review-checklist"(api, input) {
      const files = await api.workspace.listFiles();
      const checks = [
        "Check error handling and recovery.",
        "Check keyboard navigation and accessible labels.",
        "Look for unnecessary startup work and repeated I/O.",
        "Verify permissions and ensure secrets are not exposed.",
      ];
      if (files.some((f) => f.name === "package.json")) {
        const pkg = JSON.parse(await api.workspace.readText("package.json"));
        for (const key of ["test", "lint", "build", "check"])
          if (pkg.scripts?.[key])
            checks.push(`Run npm run ${key} when appropriate.`);
      }
      return {
        title: "Review checklist",
        text: `Review this project${input.trim() ? ` with a focus on ${input.trim()}` : ""}.\n\n${checks.map((c) => `- ${c}`).join("\n")}\n\nReport findings with file references and concrete fixes.`,
      };
    },
  },
};
self.VelumPlugin = plugin;
