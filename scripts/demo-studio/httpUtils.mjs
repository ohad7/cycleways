import { randomBytes, timingSafeEqual } from "node:crypto";

export function createBearerToken() {
  return randomBytes(24).toString("base64url");
}

export function requestToken(request, url) {
  const authorization = request.headers.authorization || "";
  if (authorization.startsWith("Bearer ")) return authorization.slice(7);
  return url.searchParams.get("token") || "";
}

export function isAuthorized(request, url, token) {
  const candidate = requestToken(request, url);
  const expected = Buffer.from(token);
  const actual = Buffer.from(candidate);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function sendJson(response, status, value, headers = {}) {
  const body = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": body.length,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...headers,
  });
  response.end(body);
}

export function sendText(response, status, body, contentType = "text/plain; charset=utf-8", headers = {}) {
  const bytes = Buffer.from(body);
  response.writeHead(status, {
    "content-type": contentType,
    "content-length": bytes.length,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...headers,
  });
  response.end(bytes);
}

export async function readJsonBody(request, maxBytes = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      const error = new Error(`request body exceeds ${maxBytes} bytes`);
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("request body is not valid JSON");
    error.status = 400;
    throw error;
  }
}

export function listen(server, { host = "127.0.0.1", port = 0 } = {}) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve(server.address());
    });
  });
}
