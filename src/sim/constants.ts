/** Simulation tuning shared by every fighter. Distances in world units, times in 60 Hz frames. */
export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;

export const WALL_X = 8.5;
export const MAX_SEPARATION = 7;
export const START_X = 2.5;

export const METER_BAR = 100;
export const METER_MAX = 300;
export const ROUND_SECONDS = 99;
export const ROUNDS_TO_WIN = 2;
export const MAX_ROUNDS = 5;

export const JUMP_SQUAT = 4;
export const GRAVITY = 0.0084;
export const LANDING_FRAMES = 3;
export const RUN_MIN_FRAMES = 8;
export const RUN_STOP_FRAMES = 9;
export const RUN_JUMP_VX = 0.085;

export const DOUBLE_TAP_WINDOW = 12;
export const BACKDASH_INVULN = 6;

export const INPUT_BUFFER = 6;
export const THROW_TECH_WINDOW = 10;
export const THROW_SEQUENCE = 34;
export const THROW_RELEASE = 20;
export const GRIP_SEQUENCE = 64;
export const GRIP_RELEASE = 46;

export const CLASH_FRAMES = 18;
export const CLASH_HITSTOP = 14;
export const SUPER_FREEZE = 42;

export const PARRY_SUCCESS_FRAMES = 14;
export const PARRY_CANCEL_FROM = 4;
export const PARRY_HITSTOP = 15;
export const PARRY_METER = 30;

export const INTRO_FRAMES = 120;
export const FIGHT_CALL_FRAME = 72;
export const ROUND_OVER_FRAMES = 200;

export const PUSH_HALF_GROUND = 0.41;
export const PUSH_HALF_AIR = 0.3;
export const PUSH_HEIGHT = 1.5;
