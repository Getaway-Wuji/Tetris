use serde::{Deserialize, Serialize};

pub const WIDTH: usize = 10;
pub const HEIGHT: usize = 24;
pub const HIDDEN_ROWS: usize = 4;
pub const PREVIEW_LEN: usize = 5;

// The spawn box starts one row above the visible area. The O uses the same box
// origin and has its two middle columns occupied.
pub const SPAWN_X: i16 = 3;
pub const SPAWN_Y: i16 = HIDDEN_ROWS as i16 - 1;

pub const LINES_PER_LEVEL: u32 = 10;
const GRAVITY_LEVEL_FACTOR: f64 = 1.3;
const MAX_GRAVITY_ACCELERATION: f64 = 2.0 * 20.0 / (700.0 * 700.0);
pub const LOCK_DELAY_MS: f64 = 500.0;
pub const MAX_LOCK_RESETS: u8 = 15;
pub const LINE_POINTS: [u64; 5] = [0, 100, 300, 500, 800];
pub const SOFT_DROP_POINTS: u64 = 1;
pub const HARD_DROP_POINTS: u64 = 2;

pub fn level_for_lines(lines: u32) -> u32 {
    lines / LINES_PER_LEVEL + 1
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Difficulty {
    Casual,
    #[default]
    Standard,
    Challenge,
}

pub fn gravity_acceleration(difficulty: Difficulty, level: u32) -> f64 {
    let flight_ms = 20.0 * reference_row_interval_ms(difficulty);
    scale_acceleration(40.0 / (flight_ms * flight_ms), level)
}

pub fn gravity_interval_ms(difficulty: Difficulty, level: u32) -> f64 {
    (reference_row_interval_ms(difficulty) / GRAVITY_LEVEL_FACTOR.powi((level - 1) as i32).sqrt())
        .max(35.0)
}

fn reference_row_interval_ms(difficulty: Difficulty) -> f64 {
    // Reference levels 7, 9 and 11 from the official browser game's gravity table:
    // https://play.tetris.com/tetris-game-package/game/target-desktop/assets/main/index.js
    match difficulty {
        Difficulty::Casual => 190.0,
        Difficulty::Standard => 94.0,
        Difficulty::Challenge => 43.0,
    }
}

fn scale_acceleration(initial: f64, level: u32) -> f64 {
    (initial * GRAVITY_LEVEL_FACTOR.powi((level - 1) as i32)).min(MAX_GRAVITY_ACCELERATION)
}

pub fn legacy_gravity_acceleration(level: u32) -> f64 {
    scale_acceleration(0.0000125, level)
}

pub fn gravity_deadline_ms(acceleration: f64, row: u32) -> f64 {
    (2.0 * f64::from(row) / acceleration).sqrt()
}

pub fn legacy_gravity_interval_ms(level: u32) -> f64 {
    (1000.0 * 0.85_f64.powi((level - 1) as i32)).max(80.0)
}
