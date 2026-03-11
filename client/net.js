import {
  buildRoomPath,
  HTTP_ROUTES,
  MESSAGE_TYPES,
  buildRoomWebSocketUrl,
  normalizeRoomName,
} from "../shared/protocol.js";

function apiUrl(apiBaseUrl, path) {
  return `${apiBaseUrl.replace(/\/$/, "")}${path}`;
}

export async function createRoom(apiBaseUrl, roomName) {
  const normalizedRoomName = normalizeRoomName(roomName);
  const response = await fetch(`${apiBaseUrl.replace(/\/$/, "")}${HTTP_ROUTES.rooms}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ name: normalizedRoomName }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Room creation failed: ${response.status}`);
  }

  return response.json();
}

export async function getRoom(apiBaseUrl, roomName) {
  const roomId = normalizeRoomName(roomName);
  const response = await fetch(apiUrl(apiBaseUrl, buildRoomPath(roomId)));

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Room lookup failed: ${response.status}`);
  }

  return response.json();
}

export function connectToRoom({
  apiBaseUrl,
  roomId,
  playerName,
  onOpen,
  onWelcome,
  onState,
  onClose,
  onError,
  onMessage,
}) {
  const websocketUrl = buildRoomWebSocketUrl(apiBaseUrl, roomId);
  const socket = new WebSocket(websocketUrl);

  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({ type: MESSAGE_TYPES.join, name: playerName }));
    onOpen?.({ roomId, websocketUrl });
  });

  socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }

    onMessage?.(message);

    if (message.type === MESSAGE_TYPES.welcome) {
      onWelcome?.(message);
      return;
    }

    if (message.type === MESSAGE_TYPES.state) {
      onState?.(message);
      return;
    }

    if (message.type === MESSAGE_TYPES.error) {
      onError?.(new Error(message.error || "Unknown websocket error"));
    }
  });

  socket.addEventListener("close", (event) => {
    onClose?.(event);
  });

  socket.addEventListener("error", (event) => {
    onError?.(event);
  });

  return {
    socket,
    sendInput(input, seq) {
      if (socket.readyState !== WebSocket.OPEN) {
        return;
      }

      socket.send(JSON.stringify({ type: MESSAGE_TYPES.input, input, seq }));
    },
    ping(clientTime = Date.now()) {
      if (socket.readyState !== WebSocket.OPEN) {
        return;
      }

      socket.send(JSON.stringify({ type: MESSAGE_TYPES.ping, clientTime }));
    },
    close() {
      socket.close();
    },
  };
}
