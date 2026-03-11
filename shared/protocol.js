import { DEFAULT_TICK_RATE } from "./game-config.js";

export { DEFAULT_TICK_RATE };

export const HTTP_ROUTES = {
  health: "/health",
  rooms: "/rooms",
};

export function normalizeRoomName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

export function buildRoomPath(roomId) {
  return `/rooms/${encodeURIComponent(roomId)}`;
}

export function buildRoomWebSocketPath(roomId) {
  return `${buildRoomPath(roomId)}/ws`;
}

export function apiBaseToWebSocketBase(apiBaseUrl) {
  const url = new URL(apiBaseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function buildRoomWebSocketUrl(apiBaseUrl, roomId) {
  return `${apiBaseToWebSocketBase(apiBaseUrl)}${buildRoomWebSocketPath(roomId)}`;
}

export const MESSAGE_TYPES = {
  join: "join",
  input: "input",
  ping: "ping",
  pong: "pong",
  welcome: "welcome",
  state: "state",
  error: "error",
};
