use serde::{Deserialize, Serialize};

use crate::srs::KINDS;

const NONZERO_SEED: u32 = 0x6D2B_79F5;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Bag {
    rng_state: u32,
    pieces: [u8; 7],
    cursor: usize,
}

impl Bag {
    pub fn new(seed: u32) -> Self {
        Self {
            rng_state: if seed == 0 { NONZERO_SEED } else { seed },
            pieces: KINDS,
            cursor: KINDS.len(),
        }
    }

    pub fn draw(&mut self) -> u8 {
        if self.cursor == KINDS.len() {
            self.pieces = KINDS;
            for last in (1..KINDS.len()).rev() {
                let index = self.uniform_index(last as u32 + 1);
                self.pieces.swap(last, index);
            }
            self.cursor = 0;
        }
        let kind = self.pieces[self.cursor];
        self.cursor += 1;
        kind
    }

    fn uniform_index(&mut self, count: u32) -> usize {
        // Xorshift32 over nonzero states, with rejection to keep each index equally likely.
        let limit = u32::MAX - u32::MAX % count;
        loop {
            let mut state = self.rng_state;
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            self.rng_state = state;
            if state <= limit {
                return ((state - 1) % count) as usize;
            }
        }
    }

    pub fn valid_preview(&self, queue: &[u8]) -> bool {
        if self.rng_state == 0 || !(1..=KINDS.len()).contains(&self.cursor) {
            return false;
        }
        let mut pieces = self.pieces;
        pieces.sort_unstable();
        if pieces != KINDS {
            return false;
        }
        let drawn = self.cursor.min(queue.len());
        let (previous, current) = queue.split_at(queue.len() - drawn);
        current == &self.pieces[self.cursor - drawn..self.cursor]
            && previous
                .iter()
                .enumerate()
                .all(|(i, kind)| !previous[..i].contains(kind))
    }
}
