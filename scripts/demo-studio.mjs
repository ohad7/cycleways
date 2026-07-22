#!/usr/bin/env node
import { runCli } from "./demo-studio/cli.mjs";

try {
  const result = await runCli(process.argv.slice(2));
  if (result?.ok === false) process.exitCode = 2;
} catch (error) {
  console.error(`RESULT   Command failed`);
  console.error(`WHY      ${error.message}`);
  console.error(`NEXT     npm run demo:studio -- help`);
  if (process.env.DEMO_STUDIO_DEBUG) console.error(error.stack);
  process.exitCode = 1;
}
