export const DEFAULT_TICK_RATE = 20;

export const WORLD_WIDTH = 1920;
export const WORLD_HEIGHT = 1080;

export const PLAYER_SIZE = 112;
export const PLAYER_COLLIDER_RADIUS = 32;
export const PLAYER_TURN_SPEED_PER_SECOND = Math.PI * 2.75;
export const PLAYER_SPRITE_ANGLE_OFFSET = Math.PI / 2;
export const PLAYER_MAX_SPEED_PER_SECOND = 2000;
export const PLAYER_THRUST_STEER_LERP = 0.08;
export const MAX_HEALTH = 20;
export const HEALTH_REGEN_PER_SECOND = 2;
export const HEALTH_REGEN_STAMINA_COST_PER_SECOND = 4;
export const HEALTH_REGEN_DELAY_AFTER_DAMAGE = 3;

export const MAX_STAMINA = 12;
export const DASH_COST = 4;
export const DASH_DURATION_SECONDS = 0.25;
export const STAMINA_REGEN_PER_SECOND = 2;
export const BRAKE_STAMINA_DRAIN_PER_SECOND = 1;
export const STAMINA_REGEN_DELAY_AFTER_BRAKE = 3;
export const BRAKE_FACTOR = 0.72;

export const DEFAULT_SIMULATION_SETTINGS = {
  acceleration: 3,
  damping: 1,
  slowRadius: 220,
  stopTolerance: 10,
  dashSpeed: 6500,
  postDashSpeed: 1000,
};

export const CIRCLE_FALL_SPEED_PER_SECOND = 500;
export const CIRCLE_SPAWN_INTERVAL_MIN = 0.08;
export const CIRCLE_SPAWN_INTERVAL_MAX = 0.18;
export const CIRCLE_RADIUS_MIN = 16;
export const CIRCLE_RADIUS_MAX = 34;
export const CIRCLE_HORIZONTAL_DRIFT_PER_SECOND = 20;
export const CIRCLE_PUSH_FACTOR = 0.12;
export const CIRCLE_LINEAR_DAMPING = 0.995;

export const SHIP_INVERSE_MASS = 1;
export const CIRCLE_INVERSE_MASS = 0.18;
export const COLLISION_RESTITUTION = 0.05;
export const COLLISION_FRICTION = 0.08;

export const OFFSCREEN_DESPAWN_MARGIN = 160;
export const PLAYER_SLEEP_SPEED_PER_TICK = 0.05;
