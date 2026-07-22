import { deriveDemoProjectStatus } from "./projectState.mjs";

export function formatProjectStatus(project) {
  const status = deriveDemoProjectStatus(project);
  const rows = status.stages.map((stage) => {
    const detail = stage.attemptId || stage.reason || stage.artifact || "";
    return `${stage.name.padEnd(12)} ${String(stage.state).padEnd(15)} ${detail}`.trimEnd();
  });
  return {
    status,
    text: [`PROJECT  ${project.id} · revision ${project.revision}`, "STAGE        STATE           DETAIL", ...rows, `NEXT     ./studio ${status.next.replace("demo:studio ", "")}`].join("\n"),
  };
}

export function commandResult({ result, why, wrote, kept, next, details }) {
  return [
    result && `RESULT   ${result}`,
    why && `WHY      ${why}`,
    wrote && `WROTE    ${wrote}`,
    kept && `KEPT     ${kept}`,
    next && `NEXT     ${next}`,
    details && `DETAILS  ${details}`,
  ].filter(Boolean).join("\n");
}
