const EDITABLE_PUBLICATION_ISSUES = new Set([
  "junction_name_required",
  "published_junction_topology_stale",
]);

export function junctionPublicationIsBlocked(issues = []) {
  return issues.some((issue) => !EDITABLE_PUBLICATION_ISSUES.has(issue?.code));
}
