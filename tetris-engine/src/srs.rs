//! Super Rotation System spawn shapes and ordered kick tests.
//! Kick tables use the published y-up notation; `kicks` converts to board coordinates.
//! Reference: <https://tetris.wiki/Super_Rotation_System#Wall_Kicks>.

pub const I: u8 = 1;
pub const O: u8 = 2;
pub const T: u8 = 3;
pub const S: u8 = 4;
pub const Z: u8 = 5;
pub const J: u8 = 6;
pub const L: u8 = 7;

pub const KINDS: [u8; 7] = [I, O, T, S, Z, J, L];
pub type Point = [i32; 2];
pub type Shape = [Point; 4];
type KickTests = [Point; 5];

pub const SPAWN_SHAPES: [Shape; 7] = [
    [[0, 1], [1, 1], [2, 1], [3, 1]],
    [[1, 0], [2, 0], [1, 1], [2, 1]],
    [[1, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [0, 1], [1, 1]],
    [[0, 0], [1, 0], [1, 1], [2, 1]],
    [[0, 0], [0, 1], [1, 1], [2, 1]],
    [[2, 0], [0, 1], [1, 1], [2, 1]],
];

pub fn shape(kind: u8, rotation: u8) -> Shape {
    let mut cells = SPAWN_SHAPES[usize::from(kind - 1)];
    if kind == O {
        return cells;
    }
    // The I center is (1.5, 1.5); the other rotating pieces have center (1, 1).
    let doubled_center = if kind == I { 3 } else { 2 };
    for _ in 0..rotation {
        cells = cells.map(|[x, y]| [doubled_center - y, x]);
    }
    cells
}

const JLSTZ_0_RIGHT: KickTests = [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]];
const JLSTZ_RIGHT_0: KickTests = [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]];
const JLSTZ_2_LEFT: KickTests = [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]];
const JLSTZ_LEFT_2: KickTests = [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]];

const I_0_RIGHT: KickTests = [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]];
const I_RIGHT_0: KickTests = [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]];
const I_RIGHT_2: KickTests = [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]];
const I_2_RIGHT: KickTests = [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]];

pub fn kicks(kind: u8, from: u8, to: u8) -> KickTests {
    let offsets = match (kind, from, to) {
        (O, _, _) => [[0, 0]; 5],
        (I, 0, 1) | (I, 3, 2) => I_0_RIGHT,
        (I, 1, 0) | (I, 2, 3) => I_RIGHT_0,
        (I, 1, 2) | (I, 0, 3) => I_RIGHT_2,
        (I, 2, 1) | (I, 3, 0) => I_2_RIGHT,
        (_, 0, 1) | (_, 2, 1) => JLSTZ_0_RIGHT,
        (_, 1, 0) | (_, 1, 2) => JLSTZ_RIGHT_0,
        (_, 2, 3) | (_, 0, 3) => JLSTZ_2_LEFT,
        (_, 3, 2) | (_, 3, 0) => JLSTZ_LEFT_2,
        _ => unreachable!("rotation must be a single quarter turn"),
    };
    offsets.map(|[x, y]| [x, -y])
}
