# slop-multiplayer

Static client at the repo root for GitHub Pages, authoritative backend in a Cloudflare Worker with one Durable Object per room.

## Layout

- `index.html`: GitHub Pages entrypoint and HUD markup
- `client/main.js`: browser runtime, input handling, snapshot interpolation, offline fallback
- `client/net.js`: HTTP room creation and WebSocket connection helpers
- `client-config.js`: runtime config injected before the client module loads
- `shared/game-config.js`: shared gameplay constants
- `shared/game-sim.js`: authoritative game simulation shared by client offline mode and Worker rooms
- `shared/protocol.js`: shared HTTP/WebSocket protocol helpers
- `worker/src/index.ts`: Worker entrypoint and `GameRoom` Durable Object
- `ship1.png`: ship sprite asset

## What Works Now

- Local offline play still works from `index.html`
- The browser client can create or join multiplayer rooms when `window.GAME_CONFIG.apiBaseUrl` is set
- The client sends authoritative input only:
  - mouse position
  - right-click follow press/release edges
  - left-click dash nonce
  - `B` brake press/release edges
- The Durable Object runs the shared ship/stamina/dash/circle/collision simulation at `20 TPS`
- The browser renders authoritative snapshots every frame with interpolation
- The top-right sliders remain available in offline mode and are disabled in multiplayer mode

## Room Flow

- `POST /rooms` creates a room id
- `GET /rooms/:roomId/ws` upgrades to a room WebSocket
- The server sends a `welcome` message with:
  - `playerId`
  - `roomId`
  - `tickRate`
  - `world`
  - simulation `settings`
- The client sends `join` and `input` messages
- The server broadcasts authoritative `state` snapshots

## Local Use

Preview the static client:

```bash
npm run pages:preview
```

Run the Worker locally:

```bash
npm install
npm run dev:worker
```

To enable multiplayer in the browser, set `window.GAME_CONFIG.apiBaseUrl` in `client-config.js` to your Worker base URL.
By default, the client will auto-create a room if there is no `?room=` query parameter.

## HTTP Routes

- `GET /health`
- `POST /rooms`
- `GET /rooms/:roomId/ws` with WebSocket upgrade

## Remaining Work

The project is multiplayer-ready in structure, but still needs follow-up work after deployment:

- client prediction and reconciliation for the local ship
- matchmaking / lobby UI
- persistence, auth, progression, or moderation if you want them
