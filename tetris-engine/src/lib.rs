mod bag;
mod rules;
mod srs;

#[cfg(target_arch = "wasm32")]
mod wasm;

#[cfg(test)]
mod tests;

use bag::Bag;
pub use rules::Difficulty;
use rules::*;
use serde::{Deserialize, Serialize};
use srs::{KINDS, Shape};
use std::collections::HashMap;

const SAVE_VERSION: u8 = 1;
const MAX_SAFE_SCORE: u64 = (1 << 53) - 1;
type Board = [[u8; WIDTH]; HEIGHT];
type GroupGrid = [[u32; WIDTH]; HEIGHT];

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
struct Piece {
    kind: u8,
    rotation: u8,
    x: i16,
    y: i16,
}

impl Piece {
    fn spawn(kind: u8) -> Self {
        Self {
            kind,
            rotation: 0,
            x: SPAWN_X,
            y: SPAWN_Y,
        }
    }

    fn cells(self) -> Shape {
        srs::shape(self.kind, self.rotation)
            .map(|[x, y]| [x + i32::from(self.x), y + i32::from(self.y)])
    }

    fn shift(self, dx: i16, dy: i16) -> Self {
        Self {
            x: self.x + dx,
            y: self.y + dy,
            ..self
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub enum Command {
    Left,
    Right,
    SoftDrop,
    RotateCw,
    RotateCcw,
    HardDrop,
    Hold,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Event {
    Lock {
        cells: Shape,
        kind: u8,
        group: u32,
        drop: u8,
    },
    Clear {
        rows: Vec<usize>,
        cells: Vec<[usize; 3]>,
        groups: Vec<u32>,
    },
    Hold,
    Level {
        level: u32,
    },
}

#[derive(Serialize)]
struct ActiveSnapshot {
    #[serde(flatten)]
    piece: Piece,
    cells: Shape,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot<'a> {
    board: &'a Board,
    groups: &'a GroupGrid,
    difficulty: Difficulty,
    active: Option<ActiveSnapshot>,
    ghost: &'a [[i32; 2]],
    hold: u8,
    can_hold: bool,
    next: &'a [u8; PREVIEW_LEN],
    score: u64,
    level: u32,
    lines: u32,
    elapsed_ms: f64,
    gravity_elapsed_ms: f64,
    gravity_rows: u32,
    accelerated_fall: bool,
    gravity_interval_ms: f64,
    gravity_acceleration: f64,
    game_over: bool,
    events: &'a [Event],
}

/// Authoritative rules and time. Pausing means making no calls to `advance`.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Game {
    version: u8,
    #[serde(default)]
    difficulty: Difficulty,
    board: Board,
    #[serde(default)]
    groups: GroupGrid,
    #[serde(default)]
    next_group: u32,
    active: Option<Piece>,
    bag: Bag,
    hold: u8,
    can_hold: bool,
    next: [u8; PREVIEW_LEN],
    score: u64,
    lines: u32,
    elapsed_ms: f64,
    #[serde(default)]
    gravity_elapsed_ms: f64,
    #[serde(default)]
    gravity_rows: u32,
    #[serde(default)]
    accelerated_fall: bool,
    lock_remaining_ms: f64,
    lock_resets: u8,
}

impl Game {
    pub fn new(seed: u32) -> Self {
        Self::with_difficulty(seed, Difficulty::default())
    }

    pub fn with_difficulty(seed: u32, difficulty: Difficulty) -> Self {
        let mut bag = Bag::new(seed);
        let kind = bag.draw();
        let next = std::array::from_fn(|_| bag.draw());
        Self {
            version: SAVE_VERSION,
            difficulty,
            board: [[0; WIDTH]; HEIGHT],
            groups: [[0; WIDTH]; HEIGHT],
            next_group: 1,
            active: Some(Piece::spawn(kind)),
            bag,
            hold: 0,
            can_hold: true,
            next,
            score: 0,
            lines: 0,
            elapsed_ms: 0.0,
            gravity_elapsed_ms: 0.0,
            gravity_rows: 0,
            accelerated_fall: false,
            lock_remaining_ms: LOCK_DELAY_MS,
            lock_resets: 0,
        }
    }

    pub fn command(&mut self, command: Command) -> Vec<Event> {
        let mut events = Vec::new();
        let Some(piece) = self.active else {
            return events;
        };
        if self.touches_locked_cell(piece) {
            return events;
        }
        match command {
            Command::Left => self.adjust(piece, piece.shift(-1, 0)),
            Command::Right => self.adjust(piece, piece.shift(1, 0)),
            Command::RotateCw => self.rotate(piece, (piece.rotation + 1) % 4),
            Command::RotateCcw => self.rotate(piece, (piece.rotation + 3) % 4),
            Command::SoftDrop => {
                let lower = piece.shift(0, 1);
                if self.fits(lower) {
                    self.move_active(lower);
                    self.add_score(SOFT_DROP_POINTS);
                }
            }
            Command::HardDrop => {
                let landed = self.landing(piece);
                let distance = (landed.y - piece.y) as u8;
                self.add_score(u64::from(distance) * HARD_DROP_POINTS);
                self.lock(landed, distance, &mut events);
            }
            Command::Hold if self.can_hold => {
                let held = std::mem::replace(&mut self.hold, piece.kind);
                let kind = if held == 0 { self.take_next() } else { held };
                self.can_hold = false;
                self.spawn(kind);
                events.push(Event::Hold);
            }
            Command::Hold => {}
        }
        events
    }

    /// Advances through every gravity and lock deadline, including deadlines between frames.
    pub fn advance(&mut self, mut delta_ms: f64) -> Vec<Event> {
        let mut events = Vec::new();
        if !delta_ms.is_finite() {
            return events;
        }
        // The board will fill naturally if a large delay spans several pieces. No gravity
        // or time is processed after the exact top-out deadline.
        while delta_ms > 0.0 {
            let Some(piece) = self.active else { break };
            if self.grounded(piece) {
                let step_ms = delta_ms.min(self.lock_remaining_ms);
                self.elapsed_ms += step_ms;
                delta_ms -= step_ms;
                self.lock_remaining_ms -= step_ms;
                if self.lock_remaining_ms == 0.0 {
                    self.lock(piece, 0, &mut events);
                }
                continue;
            }

            let deadline = self.gravity_deadline(self.gravity_rows + 1);
            let remaining = deadline - self.gravity_elapsed_ms;
            let step_ms = delta_ms.min(remaining);
            self.elapsed_ms += step_ms;
            delta_ms -= step_ms;
            if step_ms == remaining {
                self.gravity_elapsed_ms = deadline;
                self.gravity_rows += 1;
                self.move_active(piece.shift(0, 1));
            } else {
                self.gravity_elapsed_ms += step_ms;
            }
        }
        events
    }

    pub fn restore(input: &[u8]) -> Option<Self> {
        let mut payload: serde_json::Value = serde_json::from_slice(input).ok()?;
        let fields = payload.as_object_mut()?;
        let legacy_remaining = fields.remove("gravityRemainingMs");
        let has_gravity = fields.contains_key("gravityElapsedMs");
        let has_difficulty = fields.contains_key("difficulty");
        let has_fall_mode = fields.contains_key("acceleratedFall");
        if has_gravity != fields.contains_key("gravityRows")
            || (has_gravity && legacy_remaining.is_some())
            || (!has_gravity && legacy_remaining.is_none())
        {
            return None;
        }
        let has_groups = payload.get("groups").is_some();
        if has_groups != payload.get("nextGroup").is_some() {
            return None;
        }
        let mut game: Self = serde_json::from_value(payload).ok()?;
        if !has_groups {
            game.assign_legacy_groups();
        }
        if has_gravity && !has_fall_mode {
            game.migrate_gravity_phase(has_difficulty)?;
        }
        if !game.valid() {
            return None;
        }
        if let Some(value) = legacy_remaining {
            let remaining = value.as_f64()?;
            let interval = legacy_gravity_interval_ms(game.level());
            if !(remaining > 0.0 && remaining <= interval) {
                return None;
            }
            if game.active.is_some_and(|piece| !game.grounded(piece)) {
                let progress = (1.0 - remaining / interval).min(1.0 - 1e-12);
                game.retime_gravity(progress);
            }
        }
        Some(game)
    }

    pub fn with_snapshot<T>(&self, events: &[Event], write: impl FnOnce(Snapshot<'_>) -> T) -> T {
        let active = self.active.map(|piece| ActiveSnapshot {
            piece,
            cells: piece.cells(),
        });
        let ghost = self.active.map(|piece| self.landing(piece).cells());
        let level = self.level();
        write(Snapshot {
            board: &self.board,
            groups: &self.groups,
            difficulty: self.difficulty,
            active,
            ghost: ghost.as_ref().map_or(&[], |cells| cells.as_slice()),
            hold: self.hold,
            can_hold: self.can_hold
                && self
                    .active
                    .is_some_and(|piece| !self.touches_locked_cell(piece)),
            next: &self.next,
            score: self.score,
            level,
            lines: self.lines,
            elapsed_ms: self.elapsed_ms,
            gravity_elapsed_ms: self.gravity_elapsed_ms,
            gravity_rows: self.gravity_rows,
            accelerated_fall: self.accelerated_fall,
            gravity_interval_ms: gravity_interval_ms(self.difficulty, level),
            gravity_acceleration: gravity_acceleration(self.difficulty, level),
            game_over: self.active.is_none(),
            events,
        })
    }

    fn level(&self) -> u32 {
        level_for_lines(self.lines)
    }

    fn fits(&self, piece: Piece) -> bool {
        piece.cells().into_iter().all(|[x, y]| {
            (0..WIDTH as i32).contains(&x)
                && (0..HEIGHT as i32).contains(&y)
                && self.board[y as usize][x as usize] == 0
        })
    }

    fn grounded(&self, piece: Piece) -> bool {
        !self.fits(piece.shift(0, 1))
    }

    fn landing(&self, mut piece: Piece) -> Piece {
        while !self.grounded(piece) {
            piece.y += 1;
        }
        piece
    }

    fn adjust(&mut self, previous: Piece, adjusted: Piece) {
        if self.fits(adjusted) {
            self.apply_adjustment(previous, adjusted);
        }
    }

    fn apply_adjustment(&mut self, previous: Piece, adjusted: Piece) {
        // Only an adjustment that begins and ends grounded consumes a lock reset.
        if self.lock_resets < MAX_LOCK_RESETS && self.grounded(previous) && self.grounded(adjusted)
        {
            self.lock_remaining_ms = LOCK_DELAY_MS;
            self.lock_resets += 1;
        }
        self.move_active(adjusted);
    }

    fn rotate(&mut self, piece: Piece, rotation: u8) {
        for [dx, dy] in srs::kicks(piece.kind, piece.rotation, rotation) {
            let adjusted = Piece {
                rotation,
                ..piece.shift(dx as i16, dy as i16)
            };
            if self.fits(adjusted) {
                self.apply_adjustment(piece, adjusted);
                return;
            }
        }
    }

    fn touches_locked_cell(&self, piece: Piece) -> bool {
        let neighbors = [[0, 1], [1, 0], [0, -1], [-1, 0]];
        piece.cells().into_iter().any(|[x, y]| {
            neighbors.into_iter().any(|[dx, dy]| {
                self.board
                    .get((y + dy) as usize)
                    .and_then(|row| row.get((x + dx) as usize))
                    .is_some_and(|&kind| kind != 0)
            })
        })
    }

    fn take_next(&mut self) -> u8 {
        let kind = self.next[0];
        self.next.rotate_left(1);
        self.next[PREVIEW_LEN - 1] = self.bag.draw();
        kind
    }

    fn reset_timers(&mut self) {
        self.reset_gravity();
        self.lock_remaining_ms = LOCK_DELAY_MS;
        self.lock_resets = 0;
    }

    fn reset_gravity(&mut self) {
        self.gravity_elapsed_ms = 0.0;
        self.gravity_rows = 0;
    }

    fn move_active(&mut self, piece: Piece) {
        if self.grounded(piece) {
            self.reset_gravity();
        }
        self.active = Some(piece);
    }

    fn spawn(&mut self, kind: u8) {
        self.reset_timers();
        let piece = Piece::spawn(kind);
        self.active = self.fits(piece).then_some(piece);
        if self.active.is_none() {
            self.can_hold = false;
        }
    }

    fn add_score(&mut self, amount: u64) {
        self.score = (self.score + amount).min(MAX_SAFE_SCORE);
    }

    fn take_group(&mut self) -> u32 {
        let mut group = self.next_group;
        // Keep IDs unique among surviving cells even if the counter wraps.
        while self.groups.iter().flatten().any(|&id| id == group) {
            group = group.checked_add(1).unwrap_or(1);
        }
        self.next_group = group.checked_add(1).unwrap_or(1);
        group
    }

    fn lock(&mut self, piece: Piece, drop: u8, events: &mut Vec<Event>) {
        let cells = piece.cells();
        let group = self.take_group();
        for [x, y] in cells {
            self.board[y as usize][x as usize] = piece.kind;
            self.groups[y as usize][x as usize] = group;
        }
        events.push(Event::Lock {
            cells,
            kind: piece.kind,
            group,
            drop,
        });
        self.clear_lines(events);
        if self.board[..HIDDEN_ROWS]
            .iter()
            .flatten()
            .any(|&cell| cell != 0)
        {
            self.active = None;
            self.can_hold = false;
            self.reset_timers();
            return;
        }
        self.can_hold = true;
        let kind = self.take_next();
        self.spawn(kind);
    }

    fn clear_lines(&mut self, events: &mut Vec<Event>) {
        let mut rows = Vec::new();
        let mut cells = Vec::new();
        let mut groups = Vec::new();
        let mut destination = HEIGHT;
        for row in (0..HEIGHT).rev() {
            if self.board[row].iter().all(|&kind| kind != 0) {
                rows.push(row);
                cells.extend(
                    self.board[row]
                        .iter()
                        .enumerate()
                        .map(|(x, &kind)| [x, row, usize::from(kind)]),
                );
                groups.extend(self.groups[row]);
            } else {
                destination -= 1;
                self.board[destination] = self.board[row];
                self.groups[destination] = self.groups[row];
            }
        }
        if rows.is_empty() {
            return;
        }
        self.board[..destination].fill([0; WIDTH]);
        self.groups[..destination].fill([0; WIDTH]);
        rows.reverse();
        let cleared = rows.len();
        let previous_level = self.level();
        self.add_score(LINE_POINTS[cleared] * u64::from(previous_level));
        self.lines = self.lines.saturating_add(cleared as u32);
        events.push(Event::Clear {
            rows,
            cells,
            groups,
        });
        if self.level() != previous_level {
            events.push(Event::Level {
                level: self.level(),
            });
        }
    }

    fn assign_legacy_groups(&mut self) {
        // Older saves contain colors but no placement boundaries.
        self.next_group = 1;
        for (id, &kind) in self
            .groups
            .iter_mut()
            .flatten()
            .zip(self.board.iter().flatten())
        {
            if kind != 0 {
                *id = self.next_group;
                self.next_group += 1;
            }
        }
    }

    fn valid_groups(&self) -> bool {
        if self.next_group == 0 {
            return false;
        }
        let mut seen = HashMap::new();
        for (&id, &kind) in self
            .groups
            .iter()
            .flatten()
            .zip(self.board.iter().flatten())
        {
            if (id == 0) != (kind == 0) {
                return false;
            }
            if id != 0 {
                let (piece_kind, count) = seen.entry(id).or_insert((kind, 0));
                if *piece_kind != kind || *count == 4 {
                    return false;
                }
                *count += 1;
            }
        }
        true
    }

    fn valid(&self) -> bool {
        let kind_valid = |kind| KINDS.contains(&kind);
        self.version == SAVE_VERSION
            && self.score <= MAX_SAFE_SCORE
            && self
                .board
                .iter()
                .all(|row| row.iter().all(|&cell| cell <= srs::L) && row.contains(&0))
            && self.valid_groups()
            && self.hold <= srs::L
            && self.next.iter().all(|&kind| kind_valid(kind))
            && self.bag.valid_preview(&self.next)
            && self.elapsed_ms.is_finite()
            && self.elapsed_ms >= 0.0
            && self.valid_gravity()
            && self.lock_remaining_ms > 0.0
            && self.lock_remaining_ms <= LOCK_DELAY_MS
            && self.lock_resets <= MAX_LOCK_RESETS
            && match self.active {
                Some(piece) => {
                    kind_valid(piece.kind)
                        && piece.rotation < 4
                        && self.fits(piece)
                        && (!self.grounded(piece) || self.gravity_elapsed_ms == 0.0)
                        && (self.hold != 0 || self.can_hold)
                        && self.board[..HIDDEN_ROWS]
                            .iter()
                            .flatten()
                            .all(|&cell| cell == 0)
                }
                None => !self.can_hold && self.gravity_elapsed_ms == 0.0,
            }
    }

    fn valid_gravity(&self) -> bool {
        if self.gravity_rows >= u32::MAX - 1 {
            return false;
        }
        self.gravity_elapsed_ms >= self.gravity_deadline(self.gravity_rows)
            && self.gravity_elapsed_ms <= self.gravity_deadline(self.gravity_rows + 1)
    }

    fn gravity_deadline(&self, rows: u32) -> f64 {
        if self.accelerated_fall {
            gravity_deadline_ms(gravity_acceleration(self.difficulty, self.level()), rows)
        } else {
            f64::from(rows) * gravity_interval_ms(self.difficulty, self.level())
        }
    }

    pub fn set_accelerated_fall(&mut self, enabled: bool) {
        if enabled == self.accelerated_fall {
            return;
        }
        let level = self.level();
        let distance = if self.accelerated_fall {
            0.5 * gravity_acceleration(self.difficulty, level) * self.gravity_elapsed_ms.powi(2)
        } else {
            self.gravity_elapsed_ms / gravity_interval_ms(self.difficulty, level)
        };
        self.accelerated_fall = enabled;
        self.retime_gravity(distance);
    }

    fn retime_gravity(&mut self, distance: f64) {
        let level = self.level();
        self.gravity_elapsed_ms = if self.accelerated_fall {
            (2.0 * distance / gravity_acceleration(self.difficulty, level)).sqrt()
        } else {
            distance * gravity_interval_ms(self.difficulty, level)
        }
        .clamp(
            self.gravity_deadline(self.gravity_rows),
            self.gravity_deadline(self.gravity_rows + 1),
        );
    }

    fn migrate_gravity_phase(&mut self, has_difficulty: bool) -> Option<()> {
        let previous = if has_difficulty {
            gravity_acceleration(self.difficulty, self.level())
        } else {
            legacy_gravity_acceleration(self.level())
        };
        if self.gravity_rows >= u32::MAX - 1
            || !(gravity_deadline_ms(previous, self.gravity_rows)
                ..=gravity_deadline_ms(previous, self.gravity_rows + 1))
                .contains(&self.gravity_elapsed_ms)
        {
            return None;
        }
        self.retime_gravity(0.5 * previous * self.gravity_elapsed_ms.powi(2));
        Some(())
    }
}
