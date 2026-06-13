// Pure helpers for the planner's local memory: the autosaved draft (the
// in-progress route, stored as its encoded ?route= param) and the recents
// list ("המסלולים שלי"). Storage I/O stays in the caller (platform/storage);
// these functions only parse, validate, and order.
export const RECENTS_CAP = 5;

export function serializeDraft(draft) {
  return JSON.stringify(draft);
}

export function parseDraft(raw) {
  if (!raw) return null;
  try {
    const draft = JSON.parse(raw);
    if (!draft || typeof draft.param !== "string" || !draft.param) return null;
    return draft;
  } catch {
    return null;
  }
}

export function serializeRecents(list) {
  return JSON.stringify(list);
}

export function parseRecents(raw) {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.filter(
      (entry) => entry && typeof entry.param === "string" && entry.param,
    );
  } catch {
    return [];
  }
}

// Newest first; re-adding an existing param moves it to the front with the
// fresh metadata; the list is capped at RECENTS_CAP.
export function upsertRecent(list, entry) {
  const rest = (Array.isArray(list) ? list : []).filter(
    (item) => item.param !== entry.param,
  );
  return [entry, ...rest].slice(0, RECENTS_CAP);
}
