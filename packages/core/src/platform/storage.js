// Web implementation of the key/value storage platform service (localStorage).
// A future React Native app provides a sibling `storage.native.js`
// (AsyncStorage-backed). Reads/writes are guarded because storage can be
// unavailable in some browser privacy modes.

export function getStoredItem(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function setStoredItem(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable (e.g. privacy mode) — ignore.
  }
}
