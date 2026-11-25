use std::cell::RefCell;

use crate::{Command, Difficulty, Event, Game};

const MAX_INPUT_BYTES: usize = 16 * 1024;

thread_local! {
    static GAME: RefCell<Game> = RefCell::new(Game::new(0));
    static INPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static OUTPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

fn write_json(value: impl serde::Serialize) {
    OUTPUT.with_borrow_mut(|output| {
        output.clear();
        serde_json::to_writer(output, &value).expect("serializing a game to Vec<u8> cannot fail");
    });
}

fn write_snapshot(game: &Game, events: &[Event]) {
    game.with_snapshot(events, |snapshot| write_json(snapshot));
}

#[unsafe(no_mangle)]
pub extern "C" fn tetris_new(seed: u32) {
    tetris_new_with_difficulty(seed, 1);
}

#[unsafe(no_mangle)]
pub extern "C" fn tetris_new_with_difficulty(seed: u32, difficulty: u32) {
    let difficulty = match difficulty {
        0 => Difficulty::Casual,
        2 => Difficulty::Challenge,
        _ => Difficulty::Standard,
    };
    GAME.with_borrow_mut(|game| {
        *game = Game::with_difficulty(seed, difficulty);
        write_snapshot(game, &[]);
    });
}

#[unsafe(no_mangle)]
pub extern "C" fn tetris_set_accelerated_fall(enabled: u32) {
    GAME.with_borrow_mut(|game| {
        game.set_accelerated_fall(enabled != 0);
        write_snapshot(game, &[]);
    });
}

#[unsafe(no_mangle)]
pub extern "C" fn tetris_command(command: u32) {
    let command = match command {
        0 => Command::Left,
        1 => Command::Right,
        2 => Command::SoftDrop,
        3 => Command::RotateCw,
        4 => Command::RotateCcw,
        5 => Command::HardDrop,
        6 => Command::Hold,
        _ => return tetris_snapshot(),
    };
    GAME.with_borrow_mut(|game| {
        let events = game.command(command);
        write_snapshot(game, &events);
    });
}

#[unsafe(no_mangle)]
pub extern "C" fn tetris_advance(ms: f64) {
    GAME.with_borrow_mut(|game| {
        let events = game.advance(ms);
        write_snapshot(game, &events);
    });
}

#[unsafe(no_mangle)]
pub extern "C" fn tetris_snapshot() {
    GAME.with_borrow(|game| write_snapshot(game, &[]));
}

#[unsafe(no_mangle)]
pub extern "C" fn tetris_save() {
    GAME.with_borrow(|game| write_json(game));
}

#[unsafe(no_mangle)]
pub extern "C" fn tetris_input_ptr(len: usize) -> *mut u8 {
    if !(1..=MAX_INPUT_BYTES).contains(&len) {
        return std::ptr::null_mut();
    }
    INPUT.with_borrow_mut(|input| {
        input.resize(len, 0);
        input.as_mut_ptr()
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn tetris_restore(len: usize) -> u32 {
    let game = INPUT.with_borrow_mut(|input| {
        let parsed = if len == input.len() {
            Game::restore(input)
        } else {
            None
        };
        input.clear();
        parsed
    });
    let Some(restored) = game else {
        return 0;
    };
    GAME.with_borrow_mut(|game| {
        *game = restored;
        write_snapshot(game, &[]);
    });
    1
}

#[unsafe(no_mangle)]
pub extern "C" fn tetris_output_ptr() -> *const u8 {
    OUTPUT.with_borrow(|output| output.as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn tetris_output_len() -> usize {
    OUTPUT.with_borrow(Vec::len)
}
