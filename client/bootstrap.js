(() => {
  const GameConfig = (() => {
    const DEFAULT_TICK_RATE = 20;
    const WORLD_WIDTH = 1920;
    const WORLD_HEIGHT = 1080;
    const PLAYER_SIZE = 112;
    const PLAYER_COLLIDER_RADIUS = 32;
    const PLAYER_TURN_SPEED_PER_SECOND = Math.PI * 2.75;
    const PLAYER_SPRITE_ANGLE_OFFSET = Math.PI / 2;
    const PLAYER_MAX_SPEED_PER_SECOND = 2000;
    const PLAYER_THRUST_STEER_LERP = 0.08;
    const MAX_STAMINA = 12;
    const DASH_COST = 4;
    const DASH_DURATION_SECONDS = 0.25;
    const STAMINA_REGEN_PER_SECOND = 2;
    const BRAKE_STAMINA_DRAIN_PER_SECOND = 1;
    const STAMINA_REGEN_DELAY_AFTER_BRAKE = 3;
    const BRAKE_FACTOR = 0.72;
    const DEFAULT_SIMULATION_SETTINGS = {
      acceleration: 3,
      damping: 1,
      slowRadius: 220,
      stopTolerance: 10,
      dashSpeed: 6500,
      postDashSpeed: 1000,
    };
    const CIRCLE_FALL_SPEED_PER_SECOND = 500;
    const CIRCLE_SPAWN_INTERVAL_MIN = 0.08;
    const CIRCLE_SPAWN_INTERVAL_MAX = 0.18;
    const CIRCLE_RADIUS_MIN = 16;
    const CIRCLE_RADIUS_MAX = 34;
    const CIRCLE_HORIZONTAL_DRIFT_PER_SECOND = 20;
    const CIRCLE_PUSH_FACTOR = 0.12;
    const CIRCLE_LINEAR_DAMPING = 0.995;
    const SHIP_INVERSE_MASS = 1;
    const CIRCLE_INVERSE_MASS = 0.18;
    const COLLISION_RESTITUTION = 0.05;
    const COLLISION_FRICTION = 0.08;
    const OFFSCREEN_DESPAWN_MARGIN = 160;
    const PLAYER_SLEEP_SPEED_PER_TICK = 0.05;

    return {
      DEFAULT_TICK_RATE,
      WORLD_WIDTH,
      WORLD_HEIGHT,
      PLAYER_SIZE,
      PLAYER_COLLIDER_RADIUS,
      PLAYER_TURN_SPEED_PER_SECOND,
      PLAYER_SPRITE_ANGLE_OFFSET,
      PLAYER_MAX_SPEED_PER_SECOND,
      PLAYER_THRUST_STEER_LERP,
      MAX_STAMINA,
      DASH_COST,
      DASH_DURATION_SECONDS,
      STAMINA_REGEN_PER_SECOND,
      BRAKE_STAMINA_DRAIN_PER_SECOND,
      STAMINA_REGEN_DELAY_AFTER_BRAKE,
      BRAKE_FACTOR,
      DEFAULT_SIMULATION_SETTINGS,
      CIRCLE_FALL_SPEED_PER_SECOND,
      CIRCLE_SPAWN_INTERVAL_MIN,
      CIRCLE_SPAWN_INTERVAL_MAX,
      CIRCLE_RADIUS_MIN,
      CIRCLE_RADIUS_MAX,
      CIRCLE_HORIZONTAL_DRIFT_PER_SECOND,
      CIRCLE_PUSH_FACTOR,
      CIRCLE_LINEAR_DAMPING,
      SHIP_INVERSE_MASS,
      CIRCLE_INVERSE_MASS,
      COLLISION_RESTITUTION,
      COLLISION_FRICTION,
      OFFSCREEN_DESPAWN_MARGIN,
      PLAYER_SLEEP_SPEED_PER_TICK,
    };
  })();

  const Protocol = (() => {
    const HTTP_ROUTES = {
      health: "/health",
      rooms: "/rooms",
    };

    function buildRoomWebSocketPath(roomId) {
      return `/rooms/${encodeURIComponent(roomId)}/ws`;
    }

    function apiBaseToWebSocketBase(apiBaseUrl) {
      const url = new URL(apiBaseUrl);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.pathname = "";
      url.search = "";
      url.hash = "";
      return url.toString().replace(/\/$/, "");
    }

    function buildRoomWebSocketUrl(apiBaseUrl, roomId) {
      return `${apiBaseToWebSocketBase(apiBaseUrl)}${buildRoomWebSocketPath(roomId)}`;
    }

    const MESSAGE_TYPES = {
      join: "join",
      input: "input",
      ping: "ping",
      pong: "pong",
      welcome: "welcome",
      state: "state",
      error: "error",
    };

    return {
      DEFAULT_TICK_RATE: GameConfig.DEFAULT_TICK_RATE,
      HTTP_ROUTES,
      buildRoomWebSocketPath,
      apiBaseToWebSocketBase,
      buildRoomWebSocketUrl,
      MESSAGE_TYPES,
    };
  })();

  const Net = (() => {
    const { HTTP_ROUTES, MESSAGE_TYPES, buildRoomWebSocketUrl } = Protocol;

    async function createRoom(apiBaseUrl) {
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

    function connectToRoom({
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

    return {
      createRoom,
      connectToRoom,
    };
  })();

  const GameSim = (() => {
    const {
      BRAKE_FACTOR,
      BRAKE_STAMINA_DRAIN_PER_SECOND,
      CIRCLE_FALL_SPEED_PER_SECOND,
      CIRCLE_HORIZONTAL_DRIFT_PER_SECOND,
      CIRCLE_INVERSE_MASS,
      CIRCLE_LINEAR_DAMPING,
      CIRCLE_PUSH_FACTOR,
      CIRCLE_RADIUS_MAX,
      CIRCLE_RADIUS_MIN,
      CIRCLE_SPAWN_INTERVAL_MAX,
      CIRCLE_SPAWN_INTERVAL_MIN,
      COLLISION_FRICTION,
      COLLISION_RESTITUTION,
      DASH_COST,
      DASH_DURATION_SECONDS,
      DEFAULT_SIMULATION_SETTINGS,
      DEFAULT_TICK_RATE,
      MAX_STAMINA,
      OFFSCREEN_DESPAWN_MARGIN,
      PLAYER_COLLIDER_RADIUS,
      PLAYER_MAX_SPEED_PER_SECOND,
      PLAYER_SLEEP_SPEED_PER_TICK,
      PLAYER_THRUST_STEER_LERP,
      PLAYER_TURN_SPEED_PER_SECOND,
      SHIP_INVERSE_MASS,
      STAMINA_REGEN_DELAY_AFTER_BRAKE,
      STAMINA_REGEN_PER_SECOND,
      WORLD_HEIGHT,
      WORLD_WIDTH,
    } = GameConfig;

    const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    }

    function normalizeAngle(angle) {
      return Math.atan2(Math.sin(angle), Math.cos(angle));
    }

    function shortestAngleDelta(from, to) {
      return normalizeAngle(to - from);
    }

    function randomBetween(min, max) {
      return min + Math.random() * (max - min);
    }

    function toFiniteNumber(value, fallback) {
      const nextValue = Number(value);
      return Number.isFinite(nextValue) ? nextValue : fallback;
    }

    function nextCircleSpawnDelay() {
      return randomBetween(CIRCLE_SPAWN_INTERVAL_MIN, CIRCLE_SPAWN_INTERVAL_MAX);
    }

    function createDefaultInput() {
      return {
        pointerX: WORLD_WIDTH / 2,
        pointerY: WORLD_HEIGHT / 2,
        followPressNonce: 0,
        followReleaseNonce: 0,
        brakePressNonce: 0,
        brakeReleaseNonce: 0,
        dashNonce: 0,
      };
    }

    function createSpawnPosition(state) {
      const index = state.players.size;
      if (index === 0) {
        return {
          x: state.world.width / 2,
          y: state.world.height / 2,
        };
      }

      const ring = Math.floor(index / 6);
      const angle = GOLDEN_ANGLE * index;
      const radius = 120 + ring * 72;

      return {
        x: state.world.width / 2 + Math.cos(angle) * radius,
        y: state.world.height / 2 + Math.sin(angle) * radius,
      };
    }

    function updateFacing(player, dx, dy) {
      const distance = Math.hypot(dx, dy);
      if (!distance) {
        return;
      }

      player.facingX = dx / distance;
      player.facingY = dy / distance;
    }

    function setTargetFromAim(player) {
      player.targetX = player.input.pointerX;
      player.targetY = player.input.pointerY;
    }

    function applyControlPresses(player) {
      if (player.input.followPressNonce > player.lastConsumedFollowPressNonce) {
        player.lastConsumedFollowPressNonce = player.input.followPressNonce;
        player.followActive = true;
        setTargetFromAim(player);
      }

      if (player.input.brakePressNonce > player.lastConsumedBrakePressNonce) {
        player.lastConsumedBrakePressNonce = player.input.brakePressNonce;
        player.brakeActive = true;
      }
    }

    function applyControlReleases(player) {
      if (player.input.followReleaseNonce > player.lastConsumedFollowReleaseNonce) {
        player.lastConsumedFollowReleaseNonce = player.input.followReleaseNonce;
        player.followActive = false;
      }

      if (player.input.brakeReleaseNonce > player.lastConsumedBrakeReleaseNonce) {
        player.lastConsumedBrakeReleaseNonce = player.input.brakeReleaseNonce;
        player.brakeActive = false;
      }
    }

    function updateRotation(state, player) {
      const dx = player.input.pointerX - player.x;
      const dy = player.input.pointerY - player.y;

      if (!dx && !dy) {
        return;
      }

      updateFacing(player, dx, dy);
      const targetAngle = Math.atan2(dy, dx);
      const maxTurnStep = PLAYER_TURN_SPEED_PER_SECOND / state.tickRate;
      const delta = shortestAngleDelta(player.angle, targetAngle);
      const appliedDelta = Math.max(-maxTurnStep, Math.min(maxTurnStep, delta));
      player.angle = normalizeAngle(player.angle + appliedDelta);
    }

    function regenStamina(state, player) {
      if (player.brakeActive) {
        player.regenCooldown = STAMINA_REGEN_DELAY_AFTER_BRAKE;
        if (player.stamina > 0) {
          player.stamina = Math.max(0, player.stamina - BRAKE_STAMINA_DRAIN_PER_SECOND / state.tickRate);
        }
        return;
      }

      if (player.regenCooldown > 0) {
        player.regenCooldown = Math.max(0, player.regenCooldown - 1 / state.tickRate);
        return;
      }

      player.stamina = Math.min(MAX_STAMINA, player.stamina + STAMINA_REGEN_PER_SECOND / state.tickRate);
    }

    function applyBrake(player) {
      if (!player.brakeActive || player.stamina <= 0) {
        return;
      }

      player.vx *= BRAKE_FACTOR;
      player.vy *= BRAKE_FACTOR;

      if (Math.hypot(player.vx, player.vy) < PLAYER_SLEEP_SPEED_PER_TICK) {
        player.vx = 0;
        player.vy = 0;
      }
    }

    function clampPlayerSpeed(state, player) {
      const maxSpeedPerTick = PLAYER_MAX_SPEED_PER_SECOND / state.tickRate;
      const speed = Math.hypot(player.vx, player.vy);
      if (speed <= maxSpeedPerTick || speed === 0) {
        return;
      }

      const scale = maxSpeedPerTick / speed;
      player.vx *= scale;
      player.vy *= scale;
    }

    function steerVelocityTowardFacing(player) {
      const speed = Math.hypot(player.vx, player.vy);
      if (speed === 0) {
        return;
      }

      const dirX = player.vx / speed;
      const dirY = player.vy / speed;
      const blendedX = dirX + (player.facingX - dirX) * PLAYER_THRUST_STEER_LERP;
      const blendedY = dirY + (player.facingY - dirY) * PLAYER_THRUST_STEER_LERP;
      const blendedLength = Math.hypot(blendedX, blendedY);
      if (blendedLength < 1e-5) {
        return;
      }

      player.vx = (blendedX / blendedLength) * speed;
      player.vy = (blendedY / blendedLength) * speed;
    }

    function finishDash(player) {
      player.dashTicksRemaining = 0;
      player.vx = player.postDashVelocityX;
      player.vy = player.postDashVelocityY;
    }

    function tryStartDash(state, player) {
      if (player.input.dashNonce <= player.lastConsumedDashNonce) {
        return;
      }

      player.lastConsumedDashNonce = player.input.dashNonce;

      if (player.stamina < DASH_COST) {
        return;
      }

      player.stamina = Math.max(0, player.stamina - DASH_COST);
      player.dashTargetX = player.input.pointerX;
      player.dashTargetY = player.input.pointerY;
      updateFacing(player, player.dashTargetX - player.x, player.dashTargetY - player.y);

      player.dashTicksRemaining = Math.max(1, Math.round(DASH_DURATION_SECONDS * state.tickRate));
      player.dashVelocityX = player.facingX * (state.settings.dashSpeed / state.tickRate);
      player.dashVelocityY = player.facingY * (state.settings.dashSpeed / state.tickRate);
      player.postDashVelocityX = player.facingX * (state.settings.postDashSpeed / state.tickRate);
      player.postDashVelocityY = player.facingY * (state.settings.postDashSpeed / state.tickRate);
    }

    function updatePlayerMotion(state, player) {
      const startX = player.x;
      const startY = player.y;
      const { acceleration, damping, slowRadius, stopTolerance } = state.settings;

      if (player.followActive) {
        setTargetFromAim(player);
      }

      if (player.dashTicksRemaining > 0) {
        const dx = player.dashTargetX - player.x;
        const dy = player.dashTargetY - player.y;
        const distance = Math.hypot(dx, dy);
        const dashStep = Math.hypot(player.dashVelocityX, player.dashVelocityY);

        if (distance <= Math.max(stopTolerance, dashStep)) {
          player.x = player.dashTargetX;
          player.y = player.dashTargetY;
          const collided = resolveShipSweep(state, player, startX, startY);
          if (collided) {
            finishDash(player);
            return;
          }
          finishDash(player);
          return;
        }

        player.vx = player.dashVelocityX;
        player.vy = player.dashVelocityY;
        player.x += player.vx;
        player.y += player.vy;
        player.dashTicksRemaining -= 1;

        if (player.dashTicksRemaining === 0) {
          finishDash(player);
        }

        applyBrake(player);
        if (resolveShipSweep(state, player, startX, startY)) {
          finishDash(player);
        }
        return;
      }

      if (!player.followActive) {
        player.vx *= damping;
        player.vy *= damping;
        applyBrake(player);
        clampPlayerSpeed(state, player);

        if (Math.hypot(player.vx, player.vy) < PLAYER_SLEEP_SPEED_PER_TICK) {
          player.vx = 0;
          player.vy = 0;
        }

        player.x += player.vx;
        player.y += player.vy;
        resolveShipSweep(state, player, startX, startY);
        return;
      }

      const dx = player.targetX - player.x;
      const dy = player.targetY - player.y;
      const distance = Math.hypot(dx, dy);
      updateFacing(player, dx, dy);

      if (distance > 0) {
        const distanceRatio = Math.min(distance / slowRadius, 1);
        const accelerationStep = acceleration * distanceRatio;
        steerVelocityTowardFacing(player);
        player.vx += (dx / distance) * accelerationStep;
        player.vy += (dy / distance) * accelerationStep;
      }

      player.vx *= damping;
      player.vy *= damping;
      applyBrake(player);
      clampPlayerSpeed(state, player);

      if (distance <= stopTolerance && Math.hypot(player.vx, player.vy) < PLAYER_SLEEP_SPEED_PER_TICK) {
        player.vx = 0;
        player.vy = 0;
        player.x = player.targetX;
        player.y = player.targetY;
        resolveShipSweep(state, player, startX, startY);
        return;
      }

      player.x += player.vx;
      player.y += player.vy;
      resolveShipSweep(state, player, startX, startY);
    }

    function resolveShipCircleCollision(player, circle) {
      const dx = circle.x - player.x;
      const dy = circle.y - player.y;
      const distance = Math.hypot(dx, dy);
      const minDistance = PLAYER_COLLIDER_RADIUS + circle.radius;

      if (distance >= minDistance) {
        return false;
      }

      const normalX = distance > 0 ? dx / distance : 1;
      const normalY = distance > 0 ? dy / distance : 0;
      const overlap = minDistance - distance;
      const totalInverseMass = SHIP_INVERSE_MASS + CIRCLE_INVERSE_MASS;
      const shipShare = SHIP_INVERSE_MASS / totalInverseMass;
      const circleShare = CIRCLE_INVERSE_MASS / totalInverseMass;

      player.x -= normalX * overlap * shipShare;
      player.y -= normalY * overlap * shipShare;
      circle.x += normalX * overlap * circleShare;
      circle.y += normalY * overlap * circleShare;

      const relativeVelocityX = circle.vx - player.vx;
      const relativeVelocityY = circle.vy - player.vy;
      const velocityAlongNormal = relativeVelocityX * normalX + relativeVelocityY * normalY;

      if (velocityAlongNormal < 0) {
        const impulseMagnitude = -((1 + COLLISION_RESTITUTION) * velocityAlongNormal) / totalInverseMass;
        const impulseX = impulseMagnitude * normalX;
        const impulseY = impulseMagnitude * normalY;

        player.vx -= impulseX * SHIP_INVERSE_MASS;
        player.vy -= impulseY * SHIP_INVERSE_MASS;
        circle.vx += impulseX * CIRCLE_INVERSE_MASS;
        circle.vy += impulseY * CIRCLE_INVERSE_MASS;
      }

      const tangentX = -normalY;
      const tangentY = normalX;
      const tangentSpeed = (circle.vx - player.vx) * tangentX + (circle.vy - player.vy) * tangentY;
      player.vx += tangentX * tangentSpeed * COLLISION_FRICTION * shipShare;
      player.vy += tangentY * tangentSpeed * COLLISION_FRICTION * shipShare;
      circle.vx -= tangentX * tangentSpeed * COLLISION_FRICTION * circleShare;
      circle.vy -= tangentY * tangentSpeed * COLLISION_FRICTION * circleShare;

      circle.vx += player.vx * CIRCLE_PUSH_FACTOR;
      return true;
    }

    function sweepResolveShipCircleCollision(player, circle, startX, startY) {
      const moveX = player.x - startX;
      const moveY = player.y - startY;
      const minDistance = PLAYER_COLLIDER_RADIUS + circle.radius;
      const startDx = startX - circle.x;
      const startDy = startY - circle.y;
      const startDistanceSquared = startDx * startDx + startDy * startDy;

      if (startDistanceSquared <= minDistance * minDistance) {
        return resolveShipCircleCollision(player, circle);
      }

      const a = moveX * moveX + moveY * moveY;
      if (a <= 0) {
        return false;
      }

      const b = 2 * (startDx * moveX + startDy * moveY);
      const c = startDistanceSquared - minDistance * minDistance;
      const discriminant = b * b - 4 * a * c;

      if (discriminant < 0) {
        return false;
      }

      const sqrtDiscriminant = Math.sqrt(discriminant);
      const t0 = (-b - sqrtDiscriminant) / (2 * a);
      const t1 = (-b + sqrtDiscriminant) / (2 * a);
      const hitTime = t0 >= 0 && t0 <= 1 ? t0 : t1 >= 0 && t1 <= 1 ? t1 : null;

      if (hitTime === null) {
        return false;
      }

      const backoffTime = Math.max(0, hitTime - 0.001);
      player.x = startX + moveX * backoffTime;
      player.y = startY + moveY * backoffTime;
      return resolveShipCircleCollision(player, circle);
    }

    function resolveShipSweep(state, player, startX, startY) {
      let collided = false;
      for (const circle of state.circles) {
        collided = sweepResolveShipCircleCollision(player, circle, startX, startY) || collided;
      }
      return collided;
    }

    function updateCircles(state) {
      for (const circle of state.circles.slice()) {
        circle.x += circle.vx;
        circle.y += circle.vy;
        circle.vx *= CIRCLE_LINEAR_DAMPING;

        for (const player of state.players.values()) {
          const collided = resolveShipCircleCollision(player, circle);
          if (collided && player.dashTicksRemaining > 0) {
            finishDash(player);
          }
        }

        if (
          circle.y - circle.radius > state.world.height + OFFSCREEN_DESPAWN_MARGIN ||
          circle.x + circle.radius < -OFFSCREEN_DESPAWN_MARGIN ||
          circle.x - circle.radius > state.world.width + OFFSCREEN_DESPAWN_MARGIN
        ) {
          state.circles.splice(state.circles.indexOf(circle), 1);
        }
      }
    }

    function resolveCircleCollisions(state) {
      for (let i = 0; i < state.circles.length; i += 1) {
        const a = state.circles[i];

        for (let j = i + 1; j < state.circles.length; j += 1) {
          const b = state.circles[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const distance = Math.hypot(dx, dy);
          const minDistance = a.radius + b.radius;

          if (distance >= minDistance) {
            continue;
          }

          const normalX = distance > 0 ? dx / distance : 1;
          const normalY = distance > 0 ? dy / distance : 0;
          const overlap = minDistance - distance;
          const separation = overlap * 0.5;

          a.x -= normalX * separation;
          a.y -= normalY * separation;
          b.x += normalX * separation;
          b.y += normalY * separation;

          const relativeVelocityX = b.vx - a.vx;
          const relativeVelocityY = b.vy - a.vy;
          const velocityAlongNormal = relativeVelocityX * normalX + relativeVelocityY * normalY;

          if (velocityAlongNormal > 0) {
            continue;
          }

          const impulseMagnitude = -((1 + COLLISION_RESTITUTION) * velocityAlongNormal) / 2;
          const impulseX = impulseMagnitude * normalX;
          const impulseY = impulseMagnitude * normalY;

          a.vx -= impulseX;
          a.vy -= impulseY;
          b.vx += impulseX;
          b.vy += impulseY;

          const tangentX = -normalY;
          const tangentY = normalX;
          const tangentSpeed = relativeVelocityX * tangentX + relativeVelocityY * tangentY;
          a.vx += tangentX * tangentSpeed * COLLISION_FRICTION * 0.5;
          a.vy += tangentY * tangentSpeed * COLLISION_FRICTION * 0.5;
          b.vx -= tangentX * tangentSpeed * COLLISION_FRICTION * 0.5;
          b.vy -= tangentY * tangentSpeed * COLLISION_FRICTION * 0.5;
        }
      }
    }

    function resolvePlayerCollisions(state) {
      const players = [...state.players.values()];

      for (let i = 0; i < players.length; i += 1) {
        const a = players[i];

        for (let j = i + 1; j < players.length; j += 1) {
          const b = players[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const distance = Math.hypot(dx, dy);
          const minDistance = PLAYER_COLLIDER_RADIUS * 2;

          if (distance >= minDistance) {
            continue;
          }

          const normalX = distance > 0 ? dx / distance : 1;
          const normalY = distance > 0 ? dy / distance : 0;
          const overlap = minDistance - distance;
          const separation = overlap * 0.5;

          a.x -= normalX * separation;
          a.y -= normalY * separation;
          b.x += normalX * separation;
          b.y += normalY * separation;

          const relativeVelocityX = b.vx - a.vx;
          const relativeVelocityY = b.vy - a.vy;
          const velocityAlongNormal = relativeVelocityX * normalX + relativeVelocityY * normalY;

          if (velocityAlongNormal > 0) {
            continue;
          }

          const impulseMagnitude = -((1 + COLLISION_RESTITUTION) * velocityAlongNormal) / 2;
          const impulseX = impulseMagnitude * normalX;
          const impulseY = impulseMagnitude * normalY;

          a.vx -= impulseX;
          a.vy -= impulseY;
          b.vx += impulseX;
          b.vy += impulseY;
        }
      }
    }

    function createCircle(state) {
      const radius = randomBetween(CIRCLE_RADIUS_MIN, CIRCLE_RADIUS_MAX);
      state.circles.push({
        id: state.nextCircleId,
        x: randomBetween(radius, state.world.width - radius),
        y: -radius - randomBetween(0, 80),
        vx: randomBetween(-CIRCLE_HORIZONTAL_DRIFT_PER_SECOND, CIRCLE_HORIZONTAL_DRIFT_PER_SECOND) / state.tickRate,
        vy: CIRCLE_FALL_SPEED_PER_SECOND / state.tickRate,
        radius,
      });
      state.nextCircleId += 1;
    }

    function spawnCircles(state) {
      state.circleSpawnTimer -= 1 / state.tickRate;

      while (state.circleSpawnTimer <= 0) {
        createCircle(state);
        state.circleSpawnTimer += nextCircleSpawnDelay();
      }
    }

    function createSimulationSettings(overrides = {}) {
      return {
        ...DEFAULT_SIMULATION_SETTINGS,
        ...overrides,
      };
    }

    function createGameState(options = {}) {
      const tickRate = Math.max(1, Number(options.tickRate ?? DEFAULT_TICK_RATE));

      return {
        tickRate,
        tick: 0,
        world: {
          width: Number(options.worldWidth ?? WORLD_WIDTH),
          height: Number(options.worldHeight ?? WORLD_HEIGHT),
        },
        settings: createSimulationSettings(options.settings),
        players: new Map(),
        circles: [],
        nextCircleId: 1,
        circleSpawnTimer: nextCircleSpawnDelay(),
      };
    }

    function setTickRate(state, tickRate) {
      state.tickRate = Math.max(1, Number(tickRate) || DEFAULT_TICK_RATE);
    }

    function setSimulationSettings(state, overrides = {}) {
      state.settings = {
        ...state.settings,
        ...overrides,
      };
    }

    function addPlayer(state, { id, name, joinedAt = Date.now() }) {
      const spawn = createSpawnPosition(state);
      const player = {
        id,
        name: name || id,
        joinedAt,
        x: spawn.x,
        y: spawn.y,
        vx: 0,
        vy: 0,
        angle: 0,
        facingX: 1,
        facingY: 0,
        targetX: spawn.x,
        targetY: spawn.y,
        dashTargetX: spawn.x,
        dashTargetY: spawn.y,
        dashVelocityX: 0,
        dashVelocityY: 0,
        postDashVelocityX: 0,
        postDashVelocityY: 0,
        dashTicksRemaining: 0,
        stamina: MAX_STAMINA,
        regenCooldown: 0,
        followActive: false,
        brakeActive: false,
        input: createDefaultInput(),
        lastInputSeq: 0,
        lastConsumedDashNonce: 0,
        lastConsumedFollowPressNonce: 0,
        lastConsumedFollowReleaseNonce: 0,
        lastConsumedBrakePressNonce: 0,
        lastConsumedBrakeReleaseNonce: 0,
      };

      player.input.pointerX = spawn.x;
      player.input.pointerY = spawn.y;
      state.players.set(id, player);
      return player;
    }

    function updatePlayerInput(state, playerId, input = {}, seq) {
      const player = state.players.get(playerId);
      if (!player) {
        return null;
      }

      player.input.pointerX = toFiniteNumber(input.pointerX, player.input.pointerX);
      player.input.pointerY = toFiniteNumber(input.pointerY, player.input.pointerY);
      player.input.followPressNonce = Math.max(player.input.followPressNonce, Math.floor(toFiniteNumber(input.followPressNonce, player.input.followPressNonce)));
      player.input.followReleaseNonce = Math.max(player.input.followReleaseNonce, Math.floor(toFiniteNumber(input.followReleaseNonce, player.input.followReleaseNonce)));
      player.input.brakePressNonce = Math.max(player.input.brakePressNonce, Math.floor(toFiniteNumber(input.brakePressNonce, player.input.brakePressNonce)));
      player.input.brakeReleaseNonce = Math.max(player.input.brakeReleaseNonce, Math.floor(toFiniteNumber(input.brakeReleaseNonce, player.input.brakeReleaseNonce)));
      player.input.dashNonce = Math.max(player.input.dashNonce, Math.floor(toFiniteNumber(input.dashNonce, player.input.dashNonce)));

      if (Number.isFinite(seq)) {
        player.lastInputSeq = Number(seq);
      }

      return player;
    }

    function tickGame(state) {
      state.tick += 1;

      for (const player of state.players.values()) {
        applyControlPresses(player);
        regenStamina(state, player);
        updateRotation(state, player);
        tryStartDash(state, player);
        updatePlayerMotion(state, player);
        applyControlReleases(player);
      }

      spawnCircles(state);
      updateCircles(state);
      resolvePlayerCollisions(state);
      resolveCircleCollisions(state);
    }

    function createSnapshot(state) {
      return {
        tick: state.tick,
        tickRate: state.tickRate,
        world: {
          width: state.world.width,
          height: state.world.height,
        },
        settings: {
          ...state.settings,
        },
        players: [...state.players.values()].map((player) => ({
          id: player.id,
          name: player.name,
          x: player.x,
          y: player.y,
          vx: player.vx,
          vy: player.vy,
          angle: player.angle,
          stamina: player.stamina,
          lastInputSeq: player.lastInputSeq,
        })),
        circles: state.circles.map((circle) => ({
          id: circle.id,
          x: circle.x,
          y: circle.y,
          vx: circle.vx,
          vy: circle.vy,
          radius: circle.radius,
        })),
      };
    }

    return {
      clamp,
      normalizeAngle,
      shortestAngleDelta,
      createSimulationSettings,
      createGameState,
      setTickRate,
      setSimulationSettings,
      addPlayer,
      updatePlayerInput,
      tickGame,
      createSnapshot,
    };
  })();

  const {
    MAX_STAMINA,
    PLAYER_COLLIDER_RADIUS,
    PLAYER_SIZE,
    PLAYER_SPRITE_ANGLE_OFFSET,
    WORLD_WIDTH,
  } = GameConfig;
  const { createRoom, connectToRoom } = Net;
  const {
    addPlayer,
    createGameState,
    createSnapshot,
    setSimulationSettings,
    setTickRate,
    shortestAngleDelta,
    tickGame,
    updatePlayerInput,
  } = GameSim;

  const windowEl = document.querySelector(".window");
  const sceneEl = document.querySelector("#scene");
  const circlesLayerEl = document.querySelector("#circles-layer");
  const playersLayerEl = document.querySelector("#players-layer");
  const shipColliderEl = document.querySelector("#ship-collider");
  const statsEl = document.querySelector("#stats");
  const hudEl = document.querySelector("#hud");
  const staminaFillEl = document.querySelector("#stamina-fill");
  const staminaValueEl = document.querySelector("#stamina-value");
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
    displayedStamina: MAX_STAMINA,
    sceneScale: 1,
    sceneOffsetX: 0,
    sceneOffsetY: 0,
    worldWidth: GameConfig.WORLD_WIDTH,
    worldHeight: GameConfig.WORLD_HEIGHT,
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
      pointerY: GameConfig.WORLD_HEIGHT / 2,
      followPressNonce: 0,
      followReleaseNonce: 0,
      brakePressNonce: 0,
      brakeReleaseNonce: 0,
      dashNonce: 0,
    },
    isRightMouseDown: false,
    isBrakeHeld: false,
    nextInputSeq: 1,
    inputDirty: false,
    lastInputSentAt: 0,
  };

  function clampValue(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
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

      const alpha = clampValue(runtime.accumulator / Math.max(1, runtime.tickDurationMs), 0, 1);
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

    const alpha = clampValue((renderTime - previous.time) / Math.max(1, next.time - previous.time), 0, 1);
    return interpolateSnapshots(previous.snapshot, next.snapshot, alpha);
  }

  function updateStaminaDisplay(snapshot) {
    const player = snapshot?.players.find((entry) => entry.id === runtime.localPlayerId);
    const stamina = player?.stamina ?? MAX_STAMINA;

    runtime.displayedStamina += (stamina - runtime.displayedStamina) * 0.18;
    if (Math.abs(stamina - runtime.displayedStamina) < 0.01) {
      runtime.displayedStamina = stamina;
    }

    staminaFillEl.style.transform = `scaleX(${runtime.displayedStamina / MAX_STAMINA})`;
    staminaValueEl.textContent = `${stamina.toFixed(2)} / ${MAX_STAMINA.toFixed(2)}`;
  }

  function getOrCreatePlayerView(playerId) {
    if (!playerViews.has(playerId)) {
      const element = document.createElement("img");
      element.className = "player";
      element.src = "./ship1.png";
      element.alt = "ship";
      element.draggable = false;
      playersLayerEl.appendChild(element);
      playerViews.set(playerId, element);
    }

    return playerViews.get(playerId);
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

  function syncEntityViews(snapshot) {
    const activePlayerIds = new Set();
    const activeCircleIds = new Set();

    for (const player of snapshot.players) {
      activePlayerIds.add(player.id);
      const element = getOrCreatePlayerView(player.id);
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
  }

  function updateStats(snapshot) {
    const player = runtime.latestSnapshot?.players.find((entry) => entry.id === runtime.localPlayerId)
      || snapshot?.players.find((entry) => entry.id === runtime.localPlayerId);
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
    ].filter(Boolean);

    statsEl.textContent = lines.join("\n");
  }

  function updateCollider(snapshot) {
    const player = snapshot?.players.find((entry) => entry.id === runtime.localPlayerId);
    if (!player) {
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
    updateStaminaDisplay(runtime.latestSnapshot || snapshot);
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
        setWorldSize(message.world.width, message.world.height);
        applySliderState(message.tickRate, message.settings, true);
        pushSnapshot({
          tick: 0,
          tickRate: message.tickRate,
          world: message.world,
          settings: message.settings,
          players: [],
          circles: [],
        }, performance.now());
      },
      onState: (message) => {
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

      if (event.code === "KeyB" && !runtime.isBrakeHeld) {
        runtime.isBrakeHeld = true;
        runtime.input.brakePressNonce += 1;
        markInputDirty();
        event.preventDefault();
      }
    });

    window.addEventListener("keyup", (event) => {
      if (event.code === "KeyB" && runtime.isBrakeHeld) {
        runtime.isBrakeHeld = false;
        runtime.input.brakeReleaseNonce += 1;
        markInputDirty();
      }
    });

    windowEl.addEventListener("mousemove", (event) => {
      updatePointer(event.clientX, event.clientY);
    });

    windowEl.addEventListener("mouseenter", (event) => {
      updatePointer(event.clientX, event.clientY);
    });

    windowEl.addEventListener("mousedown", (event) => {
      if (event.button === 2 && !runtime.isRightMouseDown) {
        runtime.isRightMouseDown = true;
        updatePointer(event.clientX, event.clientY);
        runtime.input.followPressNonce += 1;
        markInputDirty();
        event.preventDefault();
        return;
      }

      if (event.button === 0 && runtime.isRightMouseDown) {
        updatePointer(event.clientX, event.clientY);
        runtime.input.dashNonce += 1;
        markInputDirty();
        event.preventDefault();
      }
    });

    window.addEventListener("mouseup", (event) => {
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
    handleSliderInput();
    handleInputEvents();
    updateSceneLayout();

    if (!config.apiBaseUrl || config.autoConnect === false) {
      initializeOfflineMode();
    } else {
      try {
        await initializeOnlineMode();
      } catch {
        initializeOfflineMode();
      }
    }

    window.requestAnimationFrame(frame);
  }

  main();
})();
