const memoryStorage = new Map();

export function getStoredItem(key) {
  return memoryStorage.has(key) ? memoryStorage.get(key) : null;
}

export function setStoredItem(key, value) {
  memoryStorage.set(key, String(value));
}
