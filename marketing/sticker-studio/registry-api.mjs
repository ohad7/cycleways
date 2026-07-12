export async function loadRegistry() {
  return request("/api/stickers/registry");
}

export async function saveRegistry(registry, expectedRevision) {
  return request("/api/stickers/registry", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ registry, expectedRevision }),
  });
}

export async function uploadPlacementPhoto(placementId, file) {
  const dataUrl = await fileToDataUrl(file);
  return request("/api/stickers/photo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ placementId, filename: file.name, dataUrl }),
  });
}

async function request(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Sticker registry request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
