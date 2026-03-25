import {
  addPlayer,
  createGameState,
  createSnapshot,
  removePlayer,
  tickGame,
  updatePlayerInput,
  updatePlayerName,
} from "../../shared/game-sim.js";
import {
  DEFAULT_TICK_RATE,
  HTTP_ROUTES,
  MESSAGE_TYPES,
  buildRoomWebSocketPath,
} from "../../shared/protocol.js";

export interface Env {
  ROOMS: DurableObjectNamespace;
}

type JoinMessage = {
  type: "join";
  name?: string;
};

type InputMessage = {
  type: "input";
  input: Record<string, unknown>;
  seq?: number;
};

type PingMessage = {
  type: "ping";
  clientTime?: number;
};

type ClientMessage = JoinMessage | InputMessage | PingMessage;

type Attachment = {
  playerId: string;
};

const TICK_RATE = DEFAULT_TICK_RATE;
const TICK_MS = 1000 / TICK_RATE;

function corsHeaders(): HeadersInit {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}

function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders(),
      ...(init?.headers ?? {}),
    },
  });
}

function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    if (url.pathname === HTTP_ROUTES.health) {
      return json({ ok: true, service: "slop-game-api" });
    }

    if (url.pathname === HTTP_ROUTES.rooms && request.method === "POST") {
      const roomId = randomId("room");
      return json({ roomId, websocketPath: buildRoomWebSocketPath(roomId) }, { status: 201 });
    }

    const roomMatch = url.pathname.match(/^\/rooms\/([^/]+)\/ws$/);
    if (roomMatch && request.headers.get("upgrade") === "websocket") {
      const roomId = roomMatch[1];
      const id = env.ROOMS.idFromName(roomId);
      const stub = env.ROOMS.get(id);
      return stub.fetch(request);
    }

    return json(
      {
        ok: false,
        error: "Not found",
        routes: [
          `GET ${HTTP_ROUTES.health}`,
          `POST ${HTTP_ROUTES.rooms}`,
          "GET /rooms/:roomId/ws (WebSocket upgrade)",
        ],
      },
      { status: 404 },
    );
  },
} satisfies ExportedHandler<Env>;

export class GameRoom implements DurableObject {
  private readonly ctx: DurableObjectState;
  private roomId = "";
  private gameState = createGameState({ tickRate: TICK_RATE });
  private loop: number | null = null;

  constructor(ctx: DurableObjectState) {
    this.ctx = ctx;
  }

  fetch(request: Request): Response {
    if (request.headers.get("upgrade") !== "websocket") {
      return json({ ok: false, error: "Expected websocket upgrade" }, { status: 426 });
    }

    const url = new URL(request.url);
    const roomMatch = url.pathname.match(/^\/rooms\/([^/]+)\/ws$/);
    if (roomMatch) {
      this.roomId = roomMatch[1];
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const playerId = randomId("player");

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ playerId } satisfies Attachment);

    const player = addPlayer(this.gameState, {
      id: playerId,
      name: playerId,
      joinedAt: Date.now(),
    });

    this.startLoop();
    this.send(server, {
      type: MESSAGE_TYPES.welcome,
      roomId: this.roomId,
      playerId,
      tickRate: this.gameState.tickRate,
      world: { ...this.gameState.world },
      settings: { ...this.gameState.settings },
      player: {
        id: player.id,
        x: player.x,
        y: player.y,
        shipId: player.shipId,
      },
    });
    this.broadcastState();

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    if (typeof message !== "string") {
      return;
    }

    const attachment = ws.deserializeAttachment() as Attachment | null;
    if (!attachment) {
      return;
    }

    let data: ClientMessage;
    try {
      data = JSON.parse(message) as ClientMessage;
    } catch {
      this.send(ws, { type: MESSAGE_TYPES.error, error: "Invalid JSON" });
      return;
    }

    if (data.type === MESSAGE_TYPES.join) {
      const name = data.name?.slice(0, 24).trim() || attachment.playerId;
      updatePlayerName(this.gameState, attachment.playerId, name);
      this.broadcastState();
      return;
    }

    if (data.type === MESSAGE_TYPES.input) {
      const player = updatePlayerInput(this.gameState, attachment.playerId, data.input ?? {}, data.seq);
      if (!player) {
        this.send(ws, { type: MESSAGE_TYPES.error, error: "Unknown player" });
      }
      return;
    }

    if (data.type === MESSAGE_TYPES.ping) {
      this.send(ws, {
        type: MESSAGE_TYPES.pong,
        clientTime: data.clientTime ?? null,
        serverTime: Date.now(),
      });
    }
  }

  webSocketClose(ws: WebSocket): void {
    this.removeSocket(ws);
  }

  webSocketError(ws: WebSocket): void {
    this.removeSocket(ws);
  }

  private removeSocket(ws: WebSocket): void {
    const attachment = ws.deserializeAttachment() as Attachment | null;
    if (!attachment) {
      return;
    }

    removePlayer(this.gameState, attachment.playerId);
    this.broadcastState();

    if (this.gameState.players.size === 0) {
      if (this.loop !== null) {
        clearInterval(this.loop);
        this.loop = null;
      }

      this.gameState = createGameState({ tickRate: TICK_RATE });
    }
  }

  private startLoop(): void {
    if (this.loop !== null) {
      return;
    }

    this.loop = setInterval(() => {
      this.tick();
    }, TICK_MS) as unknown as number;
  }

  private tick(): void {
    if (this.gameState.players.size === 0) {
      return;
    }

    tickGame(this.gameState);
    this.broadcastState();
  }

  private broadcastState(): void {
    const payload = {
      type: MESSAGE_TYPES.state,
      serverTime: Date.now(),
      roomId: this.roomId,
      ...createSnapshot(this.gameState),
    };

    for (const socket of this.ctx.getWebSockets()) {
      this.send(socket, payload);
    }
  }

  private send(ws: WebSocket, payload: unknown): void {
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      this.removeSocket(ws);
    }
  }
}
