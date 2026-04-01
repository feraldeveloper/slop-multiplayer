import {
  AVAILABLE_SHIP_IDS,
  BULLET_RADIUS,
  DEFAULT_SHIP_ID,
  MAX_HEALTH,
  MAX_STAMINA,
  PLAYER_COLLIDER_RADIUS,
  PLAYER_SIZE,
  PLAYER_SPRITE_ANGLE_OFFSET,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "../shared/game-config.js";
import {
  addPlayer,
  createGameState,
  createSnapshot,
  setSimulationSettings,
  setTickRate,
  shortestAngleDelta,
  tickGame,
  updatePlayerInput,
} from "../shared/game-sim.js";
import { createRoom, connectToRoom } from "./net.js";

const windowEl = document.querySelector(".window");
const sceneEl = document.querySelector("#scene");
const circlesLayerEl = document.querySelector("#circles-layer");
const bulletsLayerEl = document.querySelector("#bullets-layer");
const playersLayerEl = document.querySelector("#players-layer");
const shipColliderEl = document.querySelector("#ship-collider");
const statsEl = document.querySelector("#stats");
const hudEl = document.querySelector("#hud");
const healthFillEl = document.querySelector("#health-fill");
const healthValueEl = document.querySelector("#health-value");
const staminaFillEl = document.querySelector("#stamina-fill");
const staminaValueEl = document.querySelector("#stamina-value");
const respawnScreenEl = document.querySelector("#respawn-screen");
const respawnTimerEl = document.querySelector("#respawn-timer");
const respawnStatusEl = document.querySelector("#respawn-status");
const respawnButtonEl = document.querySelector("#respawn-button");
const shipGridEl = document.querySelector("#ship-grid");

const tpsSliderEl = document.querySelector("#tps-slider");
const accelerationSliderEl = document.querySelector("#acceleration-slider");
const dampingSliderEl = document.querySelector("#damping-slider");
const slowRadiusSliderEl = document.querySelector("#slow-radius-slider");
const toleranceSliderEl = document.querySelector("#tolerance-slider");
const dashSpeedSliderEl = document.querySelector("#dash-speed-slider");
const postDashSpeedSliderEl = document.querySelector("#post-dash-speed-slider");

const tpsValueEl = document.querySelector("#tps-value");
const accelerationValueEl = document.querySelector("#acceleration-value");
const dampingValueEl = document.querySelector("#damping-value");
const slowRadiusValueEl = document.querySelector("#slow-radius-value");
const toleranceValueEl = document.querySelector("#tolerance-value");
const dashSpeedValueEl = document.querySelector("#dash-speed-value");
const postDashSpeedValueEl = document.querySelector("#post-dash-speed-value");
const hudModeEl = document.querySelector("#hud-mode");

const playerViews = new Map();
const circleViews = new Map();
const bulletViews = new Map();

const config = {
  apiBaseUrl: "",
  autoConnect: true,
  autoCreateRoom: true,
  roomId: "",
  playerName: `pilot-${Math.random().toString(36).slice(2, 6)}`,
  ...(window.GAME_CONFIG || {}),
};

const runtime = {
  mode: config.apiBaseUrl ? "connecting" : "offline",
  connectionStatus: config.apiBaseUrl ? "Connecting" : "Offline",
  roomId: "",
  localPlayerId: "local-player",
  interpolationEnabled: true,
  isHudVisible: false,
  showCollider: false,
  displayedHealth: MAX_HEALTH,
  displayedStamina: MAX_STAMINA,
  sceneScale: 1,
  sceneOffsetX: 0,
  sceneOffsetY: 0,
  worldWidth: WORLD_WIDTH,
  worldHeight: WORLD_HEIGHT,
  tickRate: 20,
  tickDurationMs: 50,
  accumulator: 0,
  lastFrameTime: performance.now(),
  localSnapshotClock: performance.now(),
  snapshotBuffer: [],
  latestSnapshot: null,
  offlinePreviousSnapshot: null,
  offlineCurrentSnapshot: null,
  localGameState: null,
  multiplayerSession: null,
  input: {
    pointerX: WORLD_WIDTH / 2,
    pointerY: WORLD_HEIGHT / 2,
    followPressNonce: 0,
    followReleaseNonce: 0,
    brakePressNonce: 0,
    brakeReleaseNonce: 0,
    dashNonce: 0,
    fireNonce: 0,
    respawnNonce: 0,
    shipId: DEFAULT_SHIP_ID,
  },
  selectedShipId: DEFAULT_SHIP_ID,
  isRightMouseDown: false,
  isDashMouseDown: false,
  isBrakeHeld: false,
  respawnQueued: false,
  nextInputSeq: 1,
  inputDirty: false,
  lastInputSentAt: 0,
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function formatShipLabel(shipId) {
  return shipId.replace(/^ship/, "Ship ");
}

function getShipAssetPath(shipId) {
  return `./${shipId}.png`;
}

function getLocalPlayer(snapshot = runtime.latestSnapshot) {
  return snapshot?.players.find((entry) => entry.id === runtime.localPlayerId) || null;
}

function isRespawnScreenActive() {
  return !respawnScreenEl.classList.contains("is-hidden");
}

function setHudVisible(nextVisible) {
  runtime.isHudVisible = nextVisible;
  hudEl.classList.toggle("is-hidden", !runtime.isHudVisible);
}

function setColliderVisible(nextVisible) {
  runtime.showCollider = nextVisible;
  shipColliderEl.classList.toggle("is-visible", runtime.showCollider);
}

function updateHudMode(text) {
  hudModeEl.textContent = text;
}

function syncSelectedShip(nextShipId) {
  runtime.selectedShipId = AVAILABLE_SHIP_IDS.includes(nextShipId) ? nextShipId : DEFAULT_SHIP_ID;
  runtime.input.shipId = runtime.selectedShipId;

  for (const element of shipGridEl.querySelectorAll(".ship-option")) {
    element.classList.toggle("is-selected", element.dataset.shipId === runtime.selectedShipId);
  }
}

function buildShipPicker() {
  shipGridEl.replaceChildren();

  for (const shipId of AVAILABLE_SHIP_IDS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ship-option";
    button.dataset.shipId = shipId;
    button.innerHTML = `
      <img src="${getShipAssetPath(shipId)}" alt="${formatShipLabel(shipId)}" />
      <span class="ship-option__label">${formatShipLabel(shipId)}</span>
    `;
    button.addEventListener("click", () => {
      syncSelectedShip(shipId);
      markInputDirty();
    });
    shipGridEl.appendChild(button);
  }

  syncSelectedShip(runtime.selectedShipId);
}

function queueRespawn() {
  const player = getLocalPlayer();
  if (!player || player.isAlive || player.respawnTimer > 0) {
    return;
  }

  runtime.respawnQueued = true;
  runtime.input.shipId = runtime.selectedShipId;
  runtime.input.respawnNonce += 1;
  markInputDirty();
}

function updateRespawnOverlay(snapshot) {
  const player = getLocalPlayer(runtime.latestSnapshot || snapshot);
  if (!player || player.isAlive) {
    respawnScreenEl.classList.add("is-hidden");
    respawnStatusEl.textContent = "";
    runtime.respawnQueued = false;
    return;
  }

  respawnScreenEl.classList.remove("is-hidden");
  syncSelectedShip(runtime.input.shipId || player.shipId || runtime.selectedShipId);

  const secondsLeft = Math.max(0, player.respawnTimer || 0);
  const isReady = secondsLeft <= 0;
  respawnTimerEl.textContent = isReady ? "Respawn ready" : `Respawn in ${secondsLeft.toFixed(1)}s`;
  respawnButtonEl.disabled = !isReady || runtime.respawnQueued;
  respawnStatusEl.textContent = runtime.respawnQueued
    ? "Respawn request sent..."
    : (isReady ? "Choose a ship and jump back in." : "Choose your next ship while the timer counts down.");
}

function updateSceneLayout() {
  const scale = Math.min(windowEl.clientWidth / runtime.worldWidth, windowEl.clientHeight / runtime.worldHeight);
  const width = runtime.worldWidth * scale;
  const height = runtime.worldHeight * scale;

  runtime.sceneScale = scale;
  runtime.sceneOffsetX = (windowEl.clientWidth - width) / 2;
  runtime.sceneOffsetY = (windowEl.clientHeight - height) / 2;

  sceneEl.style.width = `${runtime.worldWidth}px`;
  sceneEl.style.height = `${runtime.worldHeight}px`;
  sceneEl.style.transform = `translate(${runtime.sceneOffsetX}px, ${runtime.sceneOffsetY}px) scale(${scale})`;
}

function setWorldSize(width, height) {
  runtime.worldWidth = width;
  runtime.worldHeight = height;
  updateSceneLayout();
}

function pushSnapshot(snapshot, time = performance.now()) {
  runtime.latestSnapshot = snapshot;
  runtime.tickRate = snapshot.tickRate;
  runtime.tickDurationMs = 1000 / runtime.tickRate;
  runtime.snapshotBuffer.push({ time, snapshot });

  while (runtime.snapshotBuffer.length > 6) {
    runtime.snapshotBuffer.shift();
  }
}

function interpolateSnapshots(previousSnapshot, nextSnapshot, alpha) {
  const previousPlayers = new Map(previousSnapshot.players.map((player) => [player.id, player]));
  const previousCircles = new Map(previousSnapshot.circles.map((circle) => [circle.id, circle]));
  const previousBullets = new Map((previousSnapshot.bullets || []).map((bullet) => [bullet.id, bullet]));

  return {
    ...nextSnapshot,
    players: nextSnapshot.players.map((player) => {
      const previous = previousPlayers.get(player.id);
      if (!previous) {
        return player;
      }

      return {
        ...player,
        x: lerp(previous.x, player.x, alpha),
        y: lerp(previous.y, player.y, alpha),
        angle: previous.angle + shortestAngleDelta(previous.angle, player.angle) * alpha,
      };
    }),
    circles: nextSnapshot.circles.map((circle) => {
      const previous = previousCircles.get(circle.id);
      if (!previous) {
        return circle;
      }

      return {
        ...circle,
        x: lerp(previous.x, circle.x, alpha),
        y: lerp(previous.y, circle.y, alpha),
      };
    }),
    bullets: (nextSnapshot.bullets || []).map((bullet) => {
      const previous = previousBullets.get(bullet.id);
      if (!previous) {
        return bullet;
      }

      return {
        ...bullet,
        x: lerp(previous.x, bullet.x, alpha),
        y: lerp(previous.y, bullet.y, alpha),
      };
    }),
  };
}

function getRenderableSnapshot(now) {
  if (runtime.mode === "offline") {
    if (!runtime.offlineCurrentSnapshot) {
      return null;
    }

    if (!runtime.interpolationEnabled || !runtime.offlinePreviousSnapshot) {
      return runtime.offlineCurrentSnapshot;
    }

    const alpha = clamp(runtime.accumulator / Math.max(1, runtime.tickDurationMs), 0, 1);
    return interpolateSnapshots(runtime.offlinePreviousSnapshot, runtime.offlineCurrentSnapshot, alpha);
  }

  if (runtime.snapshotBuffer.length === 0) {
    return null;
  }

  if (!runtime.interpolationEnabled || runtime.snapshotBuffer.length === 1) {
    return runtime.snapshotBuffer[runtime.snapshotBuffer.length - 1].snapshot;
  }

  const renderTime = now - runtime.tickDurationMs;

  while (runtime.snapshotBuffer.length >= 3 && runtime.snapshotBuffer[1].time <= renderTime) {
    runtime.snapshotBuffer.shift();
  }

  const previous = runtime.snapshotBuffer[0];
  const next = runtime.snapshotBuffer[1];

  if (!next) {
    return previous.snapshot;
  }

  const alpha = clamp((renderTime - previous.time) / Math.max(1, next.time - previous.time), 0, 1);
  return interpolateSnapshots(previous.snapshot, next.snapshot, alpha);
}

function updateStaminaDisplay(snapshot) {
  const player = getLocalPlayer(snapshot);
  const stamina = player?.stamina ?? MAX_STAMINA;

  runtime.displayedStamina += (stamina - runtime.displayedStamina) * 0.18;
  if (Math.abs(stamina - runtime.displayedStamina) < 0.01) {
    runtime.displayedStamina = stamina;
  }

  staminaFillEl.style.width = `${(runtime.displayedStamina / MAX_STAMINA) * 100}%`;
  staminaValueEl.textContent = `${stamina.toFixed(2)} / ${MAX_STAMINA.toFixed(2)}`;
}

function updateHealthDisplay(snapshot) {
  const player = getLocalPlayer(snapshot);
  const health = player?.health ?? MAX_HEALTH;

  runtime.displayedHealth += (health - runtime.displayedHealth) * 0.18;
  if (Math.abs(health - runtime.displayedHealth) < 0.01) {
    runtime.displayedHealth = health;
  }

  healthFillEl.style.width = `${(runtime.displayedHealth / MAX_HEALTH) * 100}%`;
  healthValueEl.textContent = `${health.toFixed(2)} / ${MAX_HEALTH.toFixed(2)}`;
}

function getOrCreatePlayerView(playerId, shipId = DEFAULT_SHIP_ID) {
  if (!playerViews.has(playerId)) {
    const element = document.createElement("img");
    element.className = "player";
    element.src = getShipAssetPath(shipId);
    element.alt = "ship";
    element.draggable = false;
    playersLayerEl.appendChild(element);
    playerViews.set(playerId, element);
  }

  const element = playerViews.get(playerId);
  const expectedSrc = getShipAssetPath(shipId);
  if (!element.src.endsWith(`/${shipId}.png`)) {
    element.src = expectedSrc;
  }
  return element;
}

function getOrCreateCircleView(circleId, radius) {
  if (!circleViews.has(circleId)) {
    const element = document.createElement("div");
    element.className = "circle";
    circlesLayerEl.appendChild(element);
    circleViews.set(circleId, element);
  }

  const element = circleViews.get(circleId);
  element.style.width = `${radius * 2}px`;
  element.style.height = `${radius * 2}px`;
  return element;
}

function getOrCreateBulletView(bulletId, radius = BULLET_RADIUS) {
  if (!bulletViews.has(bulletId)) {
    const element = document.createElement("div");
    element.className = "bullet";
    bulletsLayerEl.appendChild(element);
    bulletViews.set(bulletId, element);
  }

  const element = bulletViews.get(bulletId);
  const diameter = radius * 2;
  element.style.width = `${diameter}px`;
  element.style.height = `${diameter}px`;
  return element;
}

function syncEntityViews(snapshot) {
  const activePlayerIds = new Set();
  const activeCircleIds = new Set();
  const activeBulletIds = new Set();

  for (const player of snapshot.players) {
    if (!player.isAlive) {
      continue;
    }

    activePlayerIds.add(player.id);
    const element = getOrCreatePlayerView(player.id, player.shipId);
    const drawX = player.x - PLAYER_SIZE / 2;
    const drawY = player.y - PLAYER_SIZE / 2;
    element.classList.toggle("player--local", player.id === runtime.localPlayerId);
    element.style.transform = `translate(${drawX}px, ${drawY}px) rotate(${player.angle + PLAYER_SPRITE_ANGLE_OFFSET}rad)`;
  }

  for (const [playerId, element] of playerViews.entries()) {
    if (!activePlayerIds.has(playerId)) {
      element.remove();
      playerViews.delete(playerId);
    }
  }

  for (const circle of snapshot.circles) {
    activeCircleIds.add(circle.id);
    const element = getOrCreateCircleView(circle.id, circle.radius);
    element.style.transform = `translate(${circle.x - circle.radius}px, ${circle.y - circle.radius}px)`;
  }

  for (const [circleId, element] of circleViews.entries()) {
    if (!activeCircleIds.has(circleId)) {
      element.remove();
      circleViews.delete(circleId);
    }
  }

  for (const bullet of snapshot.bullets || []) {
    activeBulletIds.add(bullet.id);
    const element = getOrCreateBulletView(bullet.id, bullet.radius);
    element.style.transform = `translate(${bullet.x - bullet.radius}px, ${bullet.y - bullet.radius}px)`;
  }

  for (const [bulletId, element] of bulletViews.entries()) {
    if (!activeBulletIds.has(bulletId)) {
      element.remove();
      bulletViews.delete(bulletId);
    }
  }
}

function updateStats(snapshot) {
  const player = getLocalPlayer(runtime.latestSnapshot) || getLocalPlayer(snapshot);
  const speed = player ? Math.hypot(player.vx, player.vy) * runtime.tickRate : 0;
  const lines = [
    `mode ${runtime.mode}`,
    runtime.roomId ? `room ${runtime.roomId}` : null,
    `net ${runtime.connectionStatus}`,
    `vx ${player ? (player.vx * runtime.tickRate).toFixed(2) : "0.00"}`,
    `vy ${player ? (player.vy * runtime.tickRate).toFixed(2) : "0.00"}`,
    `|v| ${speed.toFixed(2)}`,
    `players ${snapshot?.players.length ?? 0}`,
    `circles ${snapshot?.circles.length ?? 0}`,
    `bullets ${snapshot?.bullets?.length ?? 0}`,
  ].filter(Boolean);

  statsEl.textContent = lines.join("\n");
}

function updateCollider(snapshot) {
  const player = getLocalPlayer(snapshot);
  if (!player || !player.isAlive) {
    shipColliderEl.style.transform = "translate(-9999px, -9999px)";
    return;
  }

  shipColliderEl.style.width = `${PLAYER_COLLIDER_RADIUS * 2}px`;
  shipColliderEl.style.height = `${PLAYER_COLLIDER_RADIUS * 2}px`;
  shipColliderEl.style.transform = `translate(${player.x - PLAYER_COLLIDER_RADIUS}px, ${player.y - PLAYER_COLLIDER_RADIUS}px)`;
}

function render(now) {
  const snapshot = getRenderableSnapshot(now);
  if (!snapshot) {
    updateStats(null);
    return;
  }

  syncEntityViews(snapshot);
  updateCollider(snapshot);
  updateHealthDisplay(runtime.latestSnapshot || snapshot);
  updateStaminaDisplay(runtime.latestSnapshot || snapshot);
  updateRespawnOverlay(snapshot);
  updateStats(snapshot);
}

function applySliderState(tickRate, settings, disabled) {
  tpsSliderEl.disabled = disabled;
  accelerationSliderEl.disabled = disabled;
  dampingSliderEl.disabled = disabled;
  slowRadiusSliderEl.disabled = disabled;
  toleranceSliderEl.disabled = disabled;
  dashSpeedSliderEl.disabled = disabled;
  postDashSpeedSliderEl.disabled = disabled;

  tpsSliderEl.value = String(tickRate);
  accelerationSliderEl.value = String(settings.acceleration);
  dampingSliderEl.value = String(settings.damping);
  slowRadiusSliderEl.value = String(settings.slowRadius);
  toleranceSliderEl.value = String(settings.stopTolerance);
  dashSpeedSliderEl.value = String(settings.dashSpeed);
  postDashSpeedSliderEl.value = String(settings.postDashSpeed);

  tpsValueEl.textContent = `${tickRate} TPS`;
  accelerationValueEl.textContent = Number(settings.acceleration).toFixed(2);
  dampingValueEl.textContent = Number(settings.damping).toFixed(2);
  slowRadiusValueEl.textContent = String(settings.slowRadius);
  toleranceValueEl.textContent = String(settings.stopTolerance);
  dashSpeedValueEl.textContent = String(settings.dashSpeed);
  postDashSpeedValueEl.textContent = String(settings.postDashSpeed);
}

function updateOfflineInput() {
  if (!runtime.localGameState) {
    return;
  }

  updatePlayerInput(runtime.localGameState, runtime.localPlayerId, runtime.input, runtime.nextInputSeq);
}

function markInputDirty() {
  runtime.inputDirty = true;
  if (runtime.mode === "offline") {
    updateOfflineInput();
  }
}

function clientToWorld(clientX, clientY) {
  const rect = windowEl.getBoundingClientRect();
  return {
    x: (clientX - rect.left - runtime.sceneOffsetX) / runtime.sceneScale,
    y: (clientY - rect.top - runtime.sceneOffsetY) / runtime.sceneScale,
  };
}

function updatePointer(clientX, clientY) {
  const worldPoint = clientToWorld(clientX, clientY);
  runtime.input.pointerX = worldPoint.x;
  runtime.input.pointerY = worldPoint.y;
  markInputDirty();
}

function flushNetworkInput(now) {
  if (runtime.mode !== "online" || !runtime.multiplayerSession) {
    return;
  }

  if (!runtime.inputDirty && now - runtime.lastInputSentAt < 100) {
    return;
  }

  runtime.multiplayerSession.sendInput(runtime.input, runtime.nextInputSeq);
  runtime.nextInputSeq += 1;
  runtime.inputDirty = false;
  runtime.lastInputSentAt = now;
}

function stepOfflineSimulation() {
  if (!runtime.localGameState) {
    return;
  }

  while (runtime.accumulator >= runtime.tickDurationMs) {
    runtime.offlinePreviousSnapshot = runtime.offlineCurrentSnapshot || createSnapshot(runtime.localGameState);
    updatePlayerInput(runtime.localGameState, runtime.localPlayerId, runtime.input, runtime.nextInputSeq);
    tickGame(runtime.localGameState);
    runtime.offlineCurrentSnapshot = createSnapshot(runtime.localGameState);
    runtime.latestSnapshot = runtime.offlineCurrentSnapshot;
    runtime.accumulator -= runtime.tickDurationMs;
  }
}

function frame(now) {
  const elapsed = Math.min(now - runtime.lastFrameTime, 250);
  runtime.lastFrameTime = now;
  runtime.accumulator += elapsed;

  if (runtime.mode === "offline") {
    stepOfflineSimulation();
  } else {
    flushNetworkInput(now);
  }

  render(now);
  window.requestAnimationFrame(frame);
}

function setOfflineTickRate(nextRate) {
  runtime.tickRate = nextRate;
  runtime.tickDurationMs = 1000 / nextRate;
  if (runtime.localGameState) {
    setTickRate(runtime.localGameState, nextRate);
  }
  tpsValueEl.textContent = `${nextRate} TPS`;
}

function setOfflineSettings(nextSettings) {
  if (!runtime.localGameState) {
    return;
  }

  setSimulationSettings(runtime.localGameState, nextSettings);
  applySliderState(runtime.tickRate, runtime.localGameState.settings, false);
}

function initializeOfflineMode() {
  runtime.mode = "offline";
  runtime.connectionStatus = "Local";
  runtime.roomId = "";
  runtime.multiplayerSession = null;
  runtime.localGameState = createGameState();
  addPlayer(runtime.localGameState, { id: runtime.localPlayerId, name: config.playerName });
  runtime.latestSnapshot = null;
  runtime.offlinePreviousSnapshot = null;
  runtime.offlineCurrentSnapshot = null;
  runtime.snapshotBuffer.length = 0;
  runtime.accumulator = 0;
  runtime.localSnapshotClock = performance.now();

  const initialSnapshot = createSnapshot(runtime.localGameState);
  runtime.selectedShipId = getLocalPlayer(initialSnapshot)?.shipId || DEFAULT_SHIP_ID;
  runtime.input.shipId = runtime.selectedShipId;
  runtime.tickRate = initialSnapshot.tickRate;
  runtime.tickDurationMs = 1000 / runtime.tickRate;
  setWorldSize(initialSnapshot.world.width, initialSnapshot.world.height);
  updatePlayerInput(runtime.localGameState, runtime.localPlayerId, runtime.input, runtime.nextInputSeq);
  runtime.offlinePreviousSnapshot = initialSnapshot;
  runtime.offlineCurrentSnapshot = initialSnapshot;
  runtime.latestSnapshot = initialSnapshot;
  applySliderState(runtime.tickRate, initialSnapshot.settings, false);
  updateHudMode("Local Simulation");
}

async function initializeOnlineMode() {
  runtime.mode = "connecting";
  runtime.connectionStatus = "Connecting";
  updateHudMode("Multiplayer");

  const roomFromUrl = new URL(window.location.href).searchParams.get("room");
  let roomId = config.roomId || roomFromUrl || "";

  if (!roomId && config.autoCreateRoom) {
    const created = await createRoom(config.apiBaseUrl);
    roomId = created.roomId;
    const url = new URL(window.location.href);
    url.searchParams.set("room", roomId);
    window.history.replaceState({}, "", url);
  }

  if (!roomId) {
    throw new Error("No room id available");
  }

  runtime.roomId = roomId;
  const session = connectToRoom({
    apiBaseUrl: config.apiBaseUrl,
    roomId,
    playerName: config.playerName,
    onOpen: () => {
      runtime.connectionStatus = "Connected";
      runtime.mode = "online";
      markInputDirty();
    },
    onWelcome: (message) => {
      runtime.localPlayerId = message.playerId;
      runtime.roomId = message.roomId || runtime.roomId;
      runtime.tickRate = message.tickRate;
      runtime.tickDurationMs = 1000 / runtime.tickRate;
      runtime.input.pointerX = message.player?.x ?? runtime.input.pointerX;
      runtime.input.pointerY = message.player?.y ?? runtime.input.pointerY;
      runtime.selectedShipId = message.player?.shipId || DEFAULT_SHIP_ID;
      runtime.input.shipId = runtime.selectedShipId;
      setWorldSize(message.world.width, message.world.height);
      applySliderState(message.tickRate, message.settings, true);
      pushSnapshot({
        tick: 0,
        tickRate: message.tickRate,
        world: message.world,
          settings: message.settings,
          players: [],
          circles: [],
          bullets: [],
        }, performance.now());
    },
    onState: (message) => {
      const localPlayer = message.players?.find((entry) => entry.id === runtime.localPlayerId);
      if (localPlayer?.isAlive) {
        runtime.respawnQueued = false;
      }
      pushSnapshot(message, performance.now());
    },
    onClose: () => {
      runtime.connectionStatus = "Closed";
    },
    onError: (error) => {
      runtime.connectionStatus = error?.message || "Error";
    },
  });

  runtime.multiplayerSession = session;
}

function handleSliderInput() {
  tpsSliderEl.addEventListener("input", (event) => {
    if (runtime.mode !== "offline") {
      return;
    }

    const nextRate = Number(event.target.value);
    setOfflineTickRate(nextRate);
    applySliderState(runtime.tickRate, runtime.localGameState.settings, false);
  });

  accelerationSliderEl.addEventListener("input", (event) => {
    if (runtime.mode !== "offline") {
      return;
    }

    setOfflineSettings({ acceleration: Number(event.target.value) });
  });

  dampingSliderEl.addEventListener("input", (event) => {
    if (runtime.mode !== "offline") {
      return;
    }

    setOfflineSettings({ damping: Number(event.target.value) });
  });

  slowRadiusSliderEl.addEventListener("input", (event) => {
    if (runtime.mode !== "offline") {
      return;
    }

    setOfflineSettings({ slowRadius: Number(event.target.value) });
  });

  toleranceSliderEl.addEventListener("input", (event) => {
    if (runtime.mode !== "offline") {
      return;
    }

    setOfflineSettings({ stopTolerance: Number(event.target.value) });
  });

  dashSpeedSliderEl.addEventListener("input", (event) => {
    if (runtime.mode !== "offline") {
      return;
    }

    setOfflineSettings({ dashSpeed: Number(event.target.value) });
  });

  postDashSpeedSliderEl.addEventListener("input", (event) => {
    if (runtime.mode !== "offline") {
      return;
    }

    setOfflineSettings({ postDashSpeed: Number(event.target.value) });
  });
}

function handleInputEvents() {
  respawnButtonEl.addEventListener("click", () => {
    queueRespawn();
  });

  window.addEventListener("keydown", (event) => {
    if (event.code === "Tab") {
      setHudVisible(!runtime.isHudVisible);
      event.preventDefault();
      return;
    }

    if (event.code === "KeyU") {
      runtime.interpolationEnabled = !runtime.interpolationEnabled;
      event.preventDefault();
      return;
    }

    if (event.code === "KeyO") {
      setColliderVisible(!runtime.showCollider);
      event.preventDefault();
      return;
    }

    if (isRespawnScreenActive()) {
      if ((event.code === "Enter" || event.code === "Space") && !respawnButtonEl.disabled) {
        queueRespawn();
        event.preventDefault();
      }
      return;
    }

    if (event.code === "KeyX" && !event.repeat) {
      runtime.input.fireNonce += 1;
      markInputDirty();
      event.preventDefault();
      return;
    }

    if (event.code === "KeyZ" && !runtime.isBrakeHeld) {
      runtime.isBrakeHeld = true;
      runtime.input.brakePressNonce += 1;
      markInputDirty();
      event.preventDefault();
    }
  });

  window.addEventListener("keyup", (event) => {
    if (event.code === "KeyZ" && runtime.isBrakeHeld) {
      runtime.isBrakeHeld = false;
      runtime.input.brakeReleaseNonce += 1;
      markInputDirty();
    }
  });

  windowEl.addEventListener("mousemove", (event) => {
    if (isRespawnScreenActive()) {
      return;
    }
    updatePointer(event.clientX, event.clientY);
  });

  windowEl.addEventListener("mouseenter", (event) => {
    if (isRespawnScreenActive()) {
      return;
    }
    updatePointer(event.clientX, event.clientY);
  });

  windowEl.addEventListener("mousedown", (event) => {
    if (isRespawnScreenActive()) {
      event.preventDefault();
      return;
    }

    if (event.button === 2 && !runtime.isRightMouseDown) {
      runtime.isRightMouseDown = true;
      updatePointer(event.clientX, event.clientY);
      runtime.input.followPressNonce += 1;
      markInputDirty();
      event.preventDefault();
      return;
    }

    if (event.button === 0 && runtime.isRightMouseDown && !runtime.isDashMouseDown) {
      runtime.isDashMouseDown = true;
      updatePointer(event.clientX, event.clientY);
      event.preventDefault();
    }
  });

  window.addEventListener("mouseup", (event) => {
    if (event.button === 0 && runtime.isDashMouseDown) {
      runtime.isDashMouseDown = false;
      if (runtime.isRightMouseDown) {
        updatePointer(event.clientX, event.clientY);
        runtime.input.dashNonce += 1;
        markInputDirty();
      }
    }

    if (event.button === 2 && runtime.isRightMouseDown) {
      runtime.isRightMouseDown = false;
      runtime.input.followReleaseNonce += 1;
      markInputDirty();
    }
  });

  window.addEventListener("blur", () => {
  if (runtime.isRightMouseDown) {
    runtime.isRightMouseDown = false;
    runtime.input.followReleaseNonce += 1;
  }

  if (runtime.isDashMouseDown) {
    runtime.isDashMouseDown = false;
  }

  if (runtime.isBrakeHeld) {
      runtime.isBrakeHeld = false;
      runtime.input.brakeReleaseNonce += 1;
    }

    markInputDirty();
  });

  windowEl.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });

  window.addEventListener("resize", () => {
    updateSceneLayout();
  });
}

async function main() {
  setHudVisible(false);
  setColliderVisible(false);
  buildShipPicker();
  handleSliderInput();
  handleInputEvents();
  updateSceneLayout();

  if (!config.apiBaseUrl || config.autoConnect === false) {
    initializeOfflineMode();
  } else {
    try {
      await initializeOnlineMode();
    } catch (error) {
      runtime.connectionStatus = error?.message || "Connection failed";
      initializeOfflineMode();
    }
  }

  window.requestAnimationFrame(frame);
}

main();
