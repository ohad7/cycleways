// Pure time helpers for the editor's Video Sync mode.
// Kept dependency-free and importable so they can be unit-tested in node
// (the rest of editor.js touches the DOM at import time and cannot be).

// Format a number of seconds as `m:ss.ss` (or `h:mm:ss.ss` past an hour).
export function vsFormatTime(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total - h * 3600) / 60);
  const s = total - h * 3600 - m * 60;
  const ss = s.toFixed(2).padStart(5, "0");
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${ss}`;
  }
  return `${m}:${ss}`;
}

// Parse a user-typed timestamp into seconds, or return null when unparseable.
// Accepts:
//   plain seconds  "222.5"
//   m:ss(.ss)      "3:42", "3:42.50"
//   h:mm:ss(.ss)   "1:03:42"
export function vsParseTime(str) {
  if (typeof str !== "string") return null;
  const trimmed = str.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(":");
  if (parts.length > 3) return null;

  // Each part must be a non-negative number; only the last may be fractional.
  const nums = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!/^\d*\.?\d+$/.test(part)) return null;
    const value = Number(part);
    if (!Number.isFinite(value) || value < 0) return null;
    // Minutes/seconds within a colon-separated form must be < 60.
    if (parts.length > 1 && i > 0 && value >= 60) return null;
    nums.push(value);
  }

  let seconds;
  if (nums.length === 1) {
    seconds = nums[0];
  } else if (nums.length === 2) {
    seconds = nums[0] * 60 + nums[1];
  } else {
    seconds = nums[0] * 3600 + nums[1] * 60 + nums[2];
  }
  return Number.isFinite(seconds) ? seconds : null;
}
