import { createReviewServer } from "./reviewServer.mjs";
import { commandResult } from "./status.mjs";
import { spawnChecked } from "./process.mjs";

export async function launchStudio({ options = {}, io = console } = {}) {
  const service = await createReviewServer({
    projectPath: options.project || null,
    host: options.host || "127.0.0.1",
    port: Number(options.port) || 0,
  });
  io.log(commandResult({
    result: "CycleWays Demo Studio is running",
    why: "Projects, Simulator capture, review, rendering, recovery, and publishing are managed in the browser",
    wrote: service.url,
    next: "Keep this process open; press Ctrl-C to stop the web server",
  }));
  if (!options["non-interactive"] && options.open !== false && process.platform === "darwin") {
    await spawnChecked("open", [service.url]).catch((error) => io.warn?.(`Could not open browser: ${error.message}`));
  }
  await new Promise((resolveStop) => {
    process.once("SIGINT", resolveStop);
    process.once("SIGTERM", resolveStop);
  });
  await service.close();
  return { ok: true, code: "STUDIO_CLOSED" };
}

