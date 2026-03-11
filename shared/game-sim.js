import {
  BULLET_RADIUS,
  BULLET_SPAWN_DISTANCE,
  BULLET_SPEED_PER_SECOND,
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
  FIRE_COST,
  HEALTH_REGEN_DELAY_AFTER_DAMAGE,
  HEALTH_REGEN_PER_SECOND,
  HEALTH_REGEN_STAMINA_COST_PER_SECOND,
  MAX_STAMINA,
  MAX_HEALTH,
  OFFSCREEN_DESPAWN_MARGIN,
  PLAYER_COLLIDER_RADIUS,
  PLAYER_MAX_SPEED_PER_SECOND,
  PLAYER_SLEEP_SPEED_PER_TICK,
  PLAYER_THRUST_STEER_LERP,
  PLAYER_TURN_SPEED_PER_SECOND,
  RESPAWN_DELAY_SECONDS,
  SHIP_INVERSE_MASS,
  STAMINA_REGEN_DELAY_AFTER_BRAKE,
  STAMINA_REGEN_PER_SECOND,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "./game-config.js";

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export function shortestAngleDelta(from, to) {
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
    fireNonce: 0,
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

function roundToTenth(value) {
  return Math.round(value * 10) / 10;
}

function respawnPlayer(state, player) {
  const spawn = createSpawnPosition(state);
  player.x = spawn.x;
  player.y = spawn.y;
  player.vx = 0;
  player.vy = 0;
  player.angle = 0;
  player.facingX = 1;
  player.facingY = 0;
  player.targetX = spawn.x;
  player.targetY = spawn.y;
  player.dashTargetX = spawn.x;
  player.dashTargetY = spawn.y;
  player.dashVelocityX = 0;
  player.dashVelocityY = 0;
  player.postDashVelocityX = 0;
  player.postDashVelocityY = 0;
  player.dashTicksRemaining = 0;
  player.health = MAX_HEALTH;
  player.stamina = MAX_STAMINA;
  player.regenCooldown = 0;
  player.healthRegenCooldown = 0;
  player.followActive = false;
  player.brakeActive = false;
  player.isAlive = true;
  player.respawnTimer = 0;
}

function killPlayer(player) {
  player.health = 0;
  player.vx = 0;
  player.vy = 0;
  player.dashVelocityX = 0;
  player.dashVelocityY = 0;
  player.postDashVelocityX = 0;
  player.postDashVelocityY = 0;
  player.dashTicksRemaining = 0;
  player.followActive = false;
  player.brakeActive = false;
  player.isAlive = false;
  player.respawnTimer = RESPAWN_DELAY_SECONDS;
}

function applyDamage(player, damage) {
  if (!player.isAlive) {
    return;
  }

  if (damage <= 0) {
    return;
  }

  player.health = Math.max(0, player.health - damage);
  player.healthRegenCooldown = HEALTH_REGEN_DELAY_AFTER_DAMAGE;
  if (player.health === 0) {
    killPlayer(player);
  }
}

function applyCollisionDamage(player, relativeVelocityX, relativeVelocityY, tickRate) {
  const relativeSpeedPerSecond = Math.hypot(relativeVelocityX, relativeVelocityY) * tickRate;
  const damage = roundToTenth(relativeSpeedPerSecond / 100);
  applyDamage(player, damage);
}

function updateResources(state, player) {
  if (!player.isAlive) {
    player.respawnTimer = Math.max(0, player.respawnTimer - 1 / state.tickRate);
    if (player.respawnTimer <= 0) {
      respawnPlayer(state, player);
    }
    return;
  }

  if (player.brakeActive) {
    player.regenCooldown = STAMINA_REGEN_DELAY_AFTER_BRAKE;
    if (player.stamina > 0) {
      player.stamina = Math.max(0, player.stamina - BRAKE_STAMINA_DRAIN_PER_SECOND / state.tickRate);
    }
  } else if (player.regenCooldown > 0) {
    player.regenCooldown = Math.max(0, player.regenCooldown - 1 / state.tickRate);
  } else {
    player.stamina = Math.min(MAX_STAMINA, player.stamina + STAMINA_REGEN_PER_SECOND / state.tickRate);
  }

  if (player.healthRegenCooldown > 0) {
    player.healthRegenCooldown = Math.max(0, player.healthRegenCooldown - 1 / state.tickRate);
    return;
  }

  if (player.health >= MAX_HEALTH) {
    player.health = MAX_HEALTH;
    return;
  }

  if (player.stamina < MAX_STAMINA) {
    return;
  }

  const maxAffordableHeal = player.stamina / HEALTH_REGEN_STAMINA_COST_PER_SECOND;
  const healStep = HEALTH_REGEN_PER_SECOND / state.tickRate;
  const appliedHeal = Math.min(healStep, maxAffordableHeal, MAX_HEALTH - player.health);
  if (appliedHeal <= 0) {
    return;
  }

  player.health += appliedHeal;
  player.stamina = Math.max(0, player.stamina - appliedHeal * HEALTH_REGEN_STAMINA_COST_PER_SECOND);
}

function applyBrake(player) {
  if (!player.isAlive) {
    return;
  }

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

function tryFireBullet(state, player) {
  if (!player.isAlive) {
    return;
  }

  if (player.input.fireNonce <= player.lastConsumedFireNonce) {
    return;
  }

  player.lastConsumedFireNonce = player.input.fireNonce;

  if (player.stamina < FIRE_COST) {
    return;
  }

  player.stamina = Math.max(0, player.stamina - FIRE_COST);

  const directionX = Math.cos(player.angle);
  const directionY = Math.sin(player.angle);
  state.bullets.push({
    id: state.nextBulletId,
    ownerId: player.id,
    x: player.x + directionX * BULLET_SPAWN_DISTANCE,
    y: player.y + directionY * BULLET_SPAWN_DISTANCE,
    vx: player.vx + directionX * (BULLET_SPEED_PER_SECOND / state.tickRate),
    vy: player.vy + directionY * (BULLET_SPEED_PER_SECOND / state.tickRate),
    radius: BULLET_RADIUS,
  });
  state.nextBulletId += 1;
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
  if (!player.isAlive) {
    return false;
  }

  const impactVelocityX = circle.vx - player.vx;
  const impactVelocityY = circle.vy - player.vy;
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
  applyCollisionDamage(player, impactVelocityX, impactVelocityY, player.tickRate || 1);
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

  const contactTime = Math.min(1, hitTime + 0.001);
  player.x = startX + moveX * contactTime;
  player.y = startY + moveY * contactTime;
  return resolveShipCircleCollision(player, circle);
}

function resolveShipSweep(state, player, startX, startY) {
  if (!player.isAlive) {
    return false;
  }

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
      if (!a.isAlive || !b.isAlive) {
        continue;
      }

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
      applyCollisionDamage(a, relativeVelocityX, relativeVelocityY, state.tickRate);
      applyCollisionDamage(b, relativeVelocityX, relativeVelocityY, state.tickRate);
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

function updateBullets(state) {
  for (const bullet of state.bullets.slice()) {
    bullet.x += bullet.vx;
    bullet.y += bullet.vy;

    if (
      bullet.y + bullet.radius < -OFFSCREEN_DESPAWN_MARGIN ||
      bullet.y - bullet.radius > state.world.height + OFFSCREEN_DESPAWN_MARGIN ||
      bullet.x + bullet.radius < -OFFSCREEN_DESPAWN_MARGIN ||
      bullet.x - bullet.radius > state.world.width + OFFSCREEN_DESPAWN_MARGIN
    ) {
      state.bullets.splice(state.bullets.indexOf(bullet), 1);
    }
  }
}

export function createSimulationSettings(overrides = {}) {
  return {
    ...DEFAULT_SIMULATION_SETTINGS,
    ...overrides,
  };
}

export function createGameState(options = {}) {
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
    bullets: [],
    nextCircleId: 1,
    nextBulletId: 1,
    circleSpawnTimer: nextCircleSpawnDelay(),
  };
}

export function setTickRate(state, tickRate) {
  state.tickRate = Math.max(1, Number(tickRate) || DEFAULT_TICK_RATE);
}

export function setSimulationSettings(state, overrides = {}) {
  state.settings = {
    ...state.settings,
    ...overrides,
  };
}

export function addPlayer(state, { id, name, joinedAt = Date.now() }) {
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
    tickRate: state.tickRate,
    health: MAX_HEALTH,
    stamina: MAX_STAMINA,
    regenCooldown: 0,
    healthRegenCooldown: 0,
    isAlive: true,
    respawnTimer: 0,
    followActive: false,
    brakeActive: false,
    input: createDefaultInput(),
    lastInputSeq: 0,
    lastConsumedDashNonce: 0,
    lastConsumedFollowPressNonce: 0,
    lastConsumedFollowReleaseNonce: 0,
    lastConsumedBrakePressNonce: 0,
    lastConsumedBrakeReleaseNonce: 0,
    lastConsumedFireNonce: 0,
  };

  player.input.pointerX = spawn.x;
  player.input.pointerY = spawn.y;
  state.players.set(id, player);
  return player;
}

export function removePlayer(state, playerId) {
  state.players.delete(playerId);
}

export function updatePlayerName(state, playerId, name) {
  const player = state.players.get(playerId);
  if (!player) {
    return null;
  }

  player.name = name?.trim() ? name.trim() : player.id;
  return player;
}

export function updatePlayerInput(state, playerId, input = {}, seq) {
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
  player.input.fireNonce = Math.max(player.input.fireNonce, Math.floor(toFiniteNumber(input.fireNonce, player.input.fireNonce)));

  if (Number.isFinite(seq)) {
    player.lastInputSeq = Number(seq);
  }

  return player;
}

export function tickGame(state) {
  state.tick += 1;

  for (const player of state.players.values()) {
    player.tickRate = state.tickRate;
    applyControlPresses(player);
    updateResources(state, player);
    if (!player.isAlive) {
      applyControlReleases(player);
      continue;
    }
    updateRotation(state, player);
    tryStartDash(state, player);
    tryFireBullet(state, player);
    updatePlayerMotion(state, player);
    applyControlReleases(player);
  }

  spawnCircles(state);
  updateCircles(state);
  updateBullets(state);
  resolvePlayerCollisions(state);
  resolveCircleCollisions(state);
}

export function createSnapshot(state) {
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
      health: player.health,
      isAlive: player.isAlive,
      respawnTimer: player.respawnTimer,
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
    bullets: state.bullets.map((bullet) => ({
      id: bullet.id,
      ownerId: bullet.ownerId,
      x: bullet.x,
      y: bullet.y,
      vx: bullet.vx,
      vy: bullet.vy,
      radius: bullet.radius,
    })),
  };
}
