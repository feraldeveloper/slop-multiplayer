import {
  HTTP_ROUTES,
  MESSAGE_TYPES,
  buildRoomWebSocketUrl,
} from "../shared/protocol.js";

export async function createRoom(apiBaseUrl) {
  const response = await fetch(`${apiBaseUrl.replace(/\/$/, "")}${HTTP_ROUTES.rooms}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Room creation failed: ${response.status}`);
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
