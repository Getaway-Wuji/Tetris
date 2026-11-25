use super::*;
use crate::srs::{I, J, L, O, S, T, Z};
use serde_json::json;

fn standard_gravity(level: u32) -> f64 {
    gravity_acceleration(Difficulty::Standard, level)
}

fn piece(kind: u8, rotation: u8, x: i16, y: i16) -> Piece {
    Piece {
        kind,
        rotation,
        x,
        y,
    }
}

fn with_active(piece: Piece) -> Game {
    let mut game = Game::new(27);
    game.active = Some(piece);
    assert!(game.fits(piece));
    game
}

fn has_lock(events: &[Event]) -> bool {
    events
        .iter()
        .any(|event| matches!(event, Event::Lock { .. }))
}

#[test]
fn seven_bag_shuffle_is_seeded_and_never_omits_or_duplicates_a_kind_within_a_bag() {
    for seed in [0, 1, 7, 982, u32::MAX] {
        let mut first = Bag::new(seed);
        let mut second = Bag::new(seed);
        for _ in 0..80 {
            let hand: [u8; 7] = std::array::from_fn(|_| first.draw());
            assert_eq!(hand, std::array::from_fn(|_| second.draw()));
            let mut sorted = hand;
            sorted.sort_unstable();
            assert_eq!(sorted, KINDS);
        }
    }
}

#[test]
fn initial_piece_and_all_five_previews_follow_the_bag_across_refills() {
    let mut expected = Bag::new(421);
    let mut game = Game::new(421);
    for _ in 0..44 {
        assert_eq!(game.active.unwrap(), Piece::spawn(expected.draw()));
        let mut preview = expected.clone();
        assert_eq!(game.next, std::array::from_fn(|_| preview.draw()));
        game.command(Command::HardDrop);
        game.board = [[0; WIDTH]; HEIGHT];
        game.groups = [[0; WIDTH]; HEIGHT];
    }
}

#[test]
fn seven_spawn_shapes_use_four_distinct_cells_and_cycle_in_both_directions() {
    let expected = [
        [[0, 1], [1, 1], [2, 1], [3, 1]],
        [[1, 0], [2, 0], [1, 1], [2, 1]],
        [[1, 0], [0, 1], [1, 1], [2, 1]],
        [[1, 0], [2, 0], [0, 1], [1, 1]],
        [[0, 0], [1, 0], [1, 1], [2, 1]],
        [[0, 0], [0, 1], [1, 1], [2, 1]],
        [[2, 0], [0, 1], [1, 1], [2, 1]],
    ];
    for kind in [I, O, T, S, Z, J, L] {
        let spawn = Piece::spawn(kind);
        assert_eq!(
            spawn.cells(),
            expected[usize::from(kind - 1)]
                .map(|[x, y]| [x + i32::from(SPAWN_X), y + i32::from(SPAWN_Y)])
        );
        for (command, rotations) in [
            (Command::RotateCw, [1, 2, 3, 0]),
            (Command::RotateCcw, [3, 2, 1, 0]),
        ] {
            let mut game = with_active(spawn);
            for rotation in rotations {
                assert!(game.command(command).is_empty());
                assert_eq!(game.active, Some(piece(kind, rotation, SPAWN_X, SPAWN_Y)));
                let cells = game.active.unwrap().cells();
                for (index, cell) in cells.iter().enumerate() {
                    assert!(!cells[..index].contains(cell));
                }
                if kind == O {
                    assert_eq!(cells, spawn.cells());
                }
            }
            assert_eq!(game.active, Some(spawn));
        }
    }
}

#[test]
fn srs_kicks_in_the_published_order_at_walls_and_floors() {
    let mut wall = with_active(piece(T, 1, -1, 10));
    wall.command(Command::RotateCcw);
    assert_eq!(wall.active, Some(piece(T, 0, 0, 10)));

    let mut floor = with_active(piece(T, 0, 3, 22));
    floor.command(Command::RotateCw);
    assert_eq!(floor.active, Some(piece(T, 1, 2, 21)));

    let mut floor_ccw = with_active(piece(T, 0, 3, 22));
    floor_ccw.command(Command::RotateCcw);
    assert_eq!(floor_ccw.active, Some(piece(T, 3, 4, 21)));
}

#[test]
fn all_manual_commands_are_blocked_during_orthogonal_stack_contact() {
    let active = piece(T, 0, 3, 10);
    for (x, y) in [(4, 12), (2, 11), (6, 11), (4, 9)] {
        let mut game = with_active(active);
        game.board[y][x] = Z;
        let before = game.clone();
        assert!(!game.with_snapshot(&[], |view| view.can_hold));
        for command in [
            Command::Left,
            Command::Right,
            Command::RotateCw,
            Command::RotateCcw,
            Command::SoftDrop,
            Command::HardDrop,
            Command::Hold,
        ] {
            assert!(game.command(command).is_empty());
            assert_eq!(game, before);
        }
    }
}

#[test]
fn gravity_can_slide_past_side_contact_and_restore_controls() {
    let active = piece(T, 0, 3, 10);
    let mut game = with_active(active);
    game.board[11][2] = Z;
    let step = game.gravity_deadline(1);
    assert!(game.advance(step).is_empty());
    assert_eq!(game.active, Some(active.shift(0, 1)));
    assert!(game.with_snapshot(&[], |view| view.can_hold));
    game.command(Command::Right);
    game.command(Command::RotateCw);
    assert_eq!(game.active, Some(piece(T, 1, 4, 11)));

    let mut diagonal = with_active(active);
    diagonal.board[10][2] = Z;
    diagonal.command(Command::RotateCcw);
    assert_eq!(diagonal.active, Some(piece(T, 3, 3, 10)));
}

#[test]
fn i_rotates_about_a_half_cell_and_uses_its_own_two_cell_kick() {
    let mut game = with_active(piece(I, 0, 3, 22));
    game.command(Command::RotateCw);
    assert_eq!(game.active, Some(piece(I, 1, 4, 20)));
    assert_eq!(
        game.active.unwrap().cells(),
        [[6, 20], [6, 21], [6, 22], [6, 23]]
    );
    game.command(Command::RotateCcw);
    assert_eq!(game.active, Some(piece(I, 0, 4, 20)));
}

#[test]
fn blocked_movement_and_rotation_leave_everything_unchanged() {
    let active = piece(T, 0, 3, 10);
    let mut game = with_active(active);
    for y in 8..=15 {
        for x in 1..=7 {
            if !active.cells().contains(&[x as i32, y as i32]) {
                game.board[y][x] = S;
            }
        }
    }
    game.advance(175.0);
    let before = game.clone();
    for command in [
        Command::Left,
        Command::Right,
        Command::RotateCw,
        Command::RotateCcw,
        Command::SoftDrop,
    ] {
        assert!(game.command(command).is_empty());
        assert_eq!(game, before);
    }
}

#[test]
fn soft_drop_gives_one_point_per_actual_cell_and_gravity_gives_none() {
    let mut game = with_active(piece(O, 0, 3, 19));
    let first_step = game.gravity_deadline(1);
    game.advance(first_step - 0.5);
    assert_eq!(game.active.unwrap().y, 19);
    game.advance(0.5);
    assert_eq!(game.active.unwrap().y, 20);
    assert_eq!(game.score, 0);
    for _ in 0..3 {
        game.command(Command::SoftDrop);
    }
    assert_eq!(game.active.unwrap().y, 22);
    assert_eq!(game.score, 2);
}

#[test]
fn hard_drop_matches_preview_and_zero_distance_still_locks() {
    for y in [10, 22] {
        let mut game = with_active(piece(O, 0, 3, y));
        let ghost = game.with_snapshot(&[], |view| view.ghost.to_vec());
        let events = game.command(Command::HardDrop);
        assert_eq!(
            events,
            vec![Event::Lock {
                cells: ghost.clone().try_into().unwrap(),
                kind: O,
                group: 1,
                drop: (22 - y) as u8,
            }]
        );
        assert_eq!(game.score, (22 - y) as u64 * 2);
        for [x, y] in ghost {
            assert_eq!(game.board[y as usize][x as usize], O);
        }
    }
}

#[test]
fn hold_only_once_then_returns_the_old_piece_at_its_spawn_orientation_and_position() {
    let mut game = with_active(piece(J, 3, 1, 8));
    let coming = game.next;
    assert_eq!(game.command(Command::Hold), vec![Event::Hold]);
    assert_eq!(game.hold, J);
    assert!(!game.can_hold);
    assert_eq!(game.active, Some(Piece::spawn(coming[0])));
    assert_eq!(game.next[..4], coming[1..]);
    let before = game.clone();
    assert!(game.command(Command::Hold).is_empty());
    assert_eq!(game, before);
    game.command(Command::HardDrop);
    assert!(game.can_hold);
    let latest_queue = game.next;
    assert_eq!(game.command(Command::Hold), vec![Event::Hold]);
    assert_eq!(game.active, Some(Piece::spawn(J)));
    assert_eq!(game.hold, coming[1]);
    assert_eq!(game.next, latest_queue);
}

#[test]
fn natural_grounding_and_locking_respect_exact_time_deadlines() {
    let mut game = with_active(piece(O, 0, 3, 21));
    let deadline = game.gravity_deadline(1) + LOCK_DELAY_MS;
    assert!(game.advance(deadline - 0.25).is_empty());
    assert_eq!(game.active, Some(piece(O, 0, 3, 22)));
    assert_eq!(game.gravity_elapsed_ms, 0.0);
    assert_eq!(game.gravity_rows, 0);
    assert!(matches!(
        game.advance(0.25).as_slice(),
        [Event::Lock {
            group: 1,
            drop: 0,
            ..
        }]
    ));
    assert!((game.elapsed_ms - deadline).abs() < 1e-9);
    assert_eq!(game.board[23][4], O);
    assert_eq!(game.gravity_elapsed_ms, 0.0);
}

#[test]
fn success_can_reset_lock_at_most_fifteen_times_even_with_sustained_input() {
    let mut game = with_active(piece(O, 0, 3, 22));
    for turn in 0..MAX_LOCK_RESETS {
        assert!(game.advance(490.0).is_empty());
        game.command(if turn % 2 == 0 {
            Command::Left
        } else {
            Command::Right
        });
        assert_eq!(game.lock_remaining_ms, LOCK_DELAY_MS);
        assert_eq!(game.lock_resets, turn + 1);
    }
    for _ in 0..4 {
        assert!(game.advance(100.0).is_empty());
        game.command(Command::RotateCw);
    }
    assert_eq!(game.lock_remaining_ms, 100.0);
    assert!(has_lock(&game.advance(100.0)));
}

#[test]
fn stack_contact_blocks_movement_until_the_piece_locks_naturally() {
    let mut game = with_active(piece(O, 0, 3, 17));
    game.board[19][4] = S;
    game.advance(200.0);
    game.command(Command::RotateCw);
    assert_eq!(game.lock_resets, 0);
    assert_eq!(game.lock_remaining_ms, 300.0);
    game.advance(100.0);
    game.command(Command::Right);
    game.advance(50.0);
    assert_eq!(game.active, Some(piece(O, 0, 3, 17)));
    assert_eq!(game.lock_remaining_ms, 150.0);
    assert_eq!(game.lock_resets, 0);
    game.command(Command::Left);
    assert_eq!(game.lock_remaining_ms, 150.0);
    assert!(has_lock(&game.advance(150.0)));
}

fn fill_well(game: &mut Game, start_row: usize, row_count: usize, column: usize) {
    for row in &mut game.board[start_row..start_row + row_count] {
        *row = [S; WIDTH];
        row[column] = 0;
    }
}

#[test]
fn simultaneous_one_to_four_line_clears_score_once_and_compact_above_rows() {
    for (count, &points) in LINE_POINTS.iter().enumerate().skip(1) {
        let mut game = with_active(piece(I, 1, 2, 20));
        let start = HEIGHT - count;
        fill_well(&mut game, start, count, 4);
        game.board[19][1] = J;
        let events = game.advance(LOCK_DELAY_MS);
        assert_eq!(game.score, points);
        assert_eq!(game.lines, count as u32);
        assert_eq!(game.board[19 + count][1], J);
        assert_eq!(game.board[HEIGHT - 1][4], if count == 4 { 0 } else { I });
        assert!(matches!(&events[1], Event::Clear { rows, cells, .. }
            if rows == &(start..HEIGHT).collect::<Vec<_>>() && cells.len() == count * WIDTH));
        assert_eq!(events.len(), 2);
    }
}

#[test]
fn crossing_a_level_boundary_uses_pre_clear_level_for_score_and_new_gravity_for_spawn() {
    let mut game = with_active(piece(I, 1, 2, 20));
    game.lines = 9;
    fill_well(&mut game, 20, 4, 4);
    let events = game.advance(LOCK_DELAY_MS);
    assert_eq!(game.lines, 13);
    assert_eq!(game.score, 800);
    assert_eq!(game.level(), 2);
    assert_eq!(game.gravity_elapsed_ms, 0.0);
    assert_eq!(game.gravity_rows, 0);
    assert_eq!(events[2], Event::Level { level: 2 });
    assert_eq!(gravity_deadline_ms(standard_gravity(42), 20), 700.0);
}

#[test]
fn top_out_is_checked_after_the_hidden_cells_have_had_a_chance_to_descend() {
    for count in [1, 2] {
        let mut game = with_active(piece(I, 1, 0, 2));
        game.board[6][2] = S;
        fill_well(&mut game, 6 - count, count, 2);
        assert!(game.active.is_some());
        let events = game.advance(LOCK_DELAY_MS);
        assert!(matches!(&events[1], Event::Clear { rows, .. } if rows.len() == count));
        assert_eq!(game.active.is_none(), count == 1);
        assert_eq!(game.board[3][2], if count == 1 { I } else { 0 });
        assert_eq!(game.lines, count as u32);
    }
}

#[test]
fn blocked_spawn_and_blocked_hold_swap_end_the_game() {
    let mut game = with_active(piece(O, 0, 3, 22));
    let [x, y] = Piece::spawn(game.next[0])
        .cells()
        .into_iter()
        .find(|&[_, y]| y == 4)
        .unwrap();
    game.board[y as usize][x as usize] = S;
    game.command(Command::HardDrop);
    assert!(game.active.is_none());

    let mut held = with_active(piece(O, 0, 3, 22));
    held.hold = I;
    held.board[4][3] = T;
    assert_eq!(held.command(Command::Hold), vec![Event::Hold]);
    assert!(held.active.is_none());
    let ended = held.clone();
    assert!(held.advance(5000.0).is_empty());
    assert!(held.command(Command::Right).is_empty());
    assert_eq!(held, ended);
}

#[test]
fn pausing_preserves_remaining_time_and_advancing_in_slices_matches_a_single_advance() {
    let mut split = Game::new(41212);
    let mut continuous = split.clone();
    split.advance(999.75);
    let paused = serde_json::to_vec(&split).unwrap();
    let resumed = Game::restore(&paused).unwrap();
    assert_eq!(resumed, split);
    split = resumed;
    split.advance(0.25);
    split.advance(4500.0);
    continuous.advance(5500.0);
    assert_eq!(split, continuous);
}

#[test]
fn snapshots_report_the_exact_gravity_phase_before_and_after_restoring() {
    let mut game = with_active(piece(T, 0, 3, 10));
    game.lines = LINES_PER_LEVEL;
    game.reset_timers();
    game.advance(26.375);
    game.command(Command::SoftDrop);
    let snapshot =
        |state: &Game| state.with_snapshot(&[], |view| serde_json::to_value(view).unwrap());
    let partial = snapshot(&game);
    assert_eq!(partial["gravityAcceleration"], standard_gravity(2));
    assert_eq!(partial["gravityIntervalMs"], game.gravity_deadline(1));
    assert_eq!(partial["acceleratedFall"], false);
    assert_eq!(partial["gravityElapsedMs"], 26.375);
    assert_eq!(partial["gravityRows"], 0);
    assert_eq!(partial["elapsedMs"], 26.375);

    let mut restored = Game::restore(&serde_json::to_vec(&game).unwrap()).unwrap();
    assert_eq!(snapshot(&restored), partial);
    let deadline = restored.gravity_deadline(1);
    restored.advance(deadline - 26.375);
    let step = snapshot(&restored);
    assert_eq!(step["active"]["y"], 12);
    assert_eq!(step["gravityElapsedMs"], deadline);
    assert_eq!(step["gravityRows"], 1);
    assert_eq!(step["elapsedMs"], deadline);
}

#[test]
fn gravity_crosses_later_rows_faster() {
    let mut game = with_active(piece(O, 0, 3, 2));
    game.set_accelerated_fall(true);
    let acceleration = standard_gravity(1);
    let mut previous_deadline = 0.0;
    let mut previous_spacing = f64::INFINITY;
    for rows in 1..=20 {
        let deadline = gravity_deadline_ms(acceleration, rows);
        let spacing = deadline - previous_deadline;
        assert!(spacing < previous_spacing);
        assert!(game.advance(spacing).is_empty());
        assert_eq!(game.active.unwrap().y, 2 + rows as i16);
        if rows < 20 {
            assert_eq!(game.gravity_rows, rows);
        }
        previous_deadline = deadline;
        previous_spacing = spacing;
    }
    assert!((game.elapsed_ms - 1880.0).abs() < 1e-9);
    assert_eq!(game.gravity_rows, 0);
    assert_eq!(game.gravity_elapsed_ms, 0.0);
}

#[test]
fn airborne_commands_keep_gravity_momentum_until_reaching_support() {
    let mut game = with_active(piece(O, 0, 3, 10));
    game.set_accelerated_fall(true);
    game.board[15][4] = T;
    game.advance(650.0);
    assert_eq!(game.gravity_rows, 2);
    assert_eq!(game.active.unwrap().y, 12);
    game.command(Command::RotateCw);
    game.command(Command::Left);
    game.command(Command::Right);
    assert_eq!(game.gravity_rows, 2);
    assert_eq!(game.gravity_elapsed_ms, 650.0);

    game.command(Command::SoftDrop);
    assert_eq!(game.active.unwrap().y, 13);
    assert_eq!(game.gravity_rows, 0);
    assert_eq!(game.gravity_elapsed_ms, 0.0);
    game.advance(200.0);
    game.command(Command::Right);
    assert_eq!(game.active, Some(piece(O, 1, 3, 13)));
    assert_eq!(game.lock_remaining_ms, 300.0);
    assert_eq!(game.gravity_elapsed_ms, 0.0);
    assert!(has_lock(&game.advance(300.0)));
}

#[test]
fn legacy_gravity_preserves_the_same_fraction_of_the_current_grid_step() {
    let game = with_active(piece(T, 0, 3, 10));
    let mut payload = serde_json::to_value(&game).unwrap();
    let fields = payload.as_object_mut().unwrap();
    fields.remove("acceleratedFall");
    fields.remove("gravityElapsedMs");
    fields.remove("gravityRows");
    fields.insert("gravityRemainingMs".into(), json!(750.0));
    let restored = Game::restore(&serde_json::to_vec(&payload).unwrap()).unwrap();
    assert_eq!(restored.active, game.active);
    assert!((restored.gravity_elapsed_ms - restored.gravity_deadline(1) * 0.25).abs() < 1e-9);
    assert_eq!(restored.gravity_rows, 0);
    payload["gravityRemainingMs"] = json!(1001.0);
    assert!(Game::restore(&serde_json::to_vec(&payload).unwrap()).is_none());
}

#[test]
fn three_difficulties_match_the_published_reference_durations_and_restore_exactly() {
    for (difficulty, expected_name, full_fall) in [
        (Difficulty::Casual, "casual", 3_800.0),
        (Difficulty::Standard, "standard", 1_880.0),
        (Difficulty::Challenge, "challenge", 860.0),
    ] {
        let mut game = Game::with_difficulty(42, difficulty);
        assert!((game.gravity_deadline(20) - full_fall).abs() < 1e-9);
        let acceleration = gravity_acceleration(difficulty, 1);
        assert!((gravity_deadline_ms(acceleration, 20) - full_fall).abs() < 1e-9);
        assert!(gravity_acceleration(difficulty, 2) > acceleration);
        assert_eq!(
            gravity_deadline_ms(gravity_acceleration(difficulty, 42), 20),
            700.0
        );
        game.advance(full_fall * 0.5);
        let snapshot = game.with_snapshot(&[], |view| serde_json::to_value(view).unwrap());
        assert_eq!(snapshot["difficulty"], expected_name);
        assert_eq!(snapshot["gravityAcceleration"], acceleration);
        assert_eq!(snapshot["gravityRows"], 10);
        assert_eq!(snapshot["acceleratedFall"], false);
        let saved = serde_json::to_vec(&game).unwrap();
        assert_eq!(Game::restore(&saved), Some(game));
    }
    assert_eq!(
        Game::new(42),
        Game::with_difficulty(42, Difficulty::Standard)
    );
}

#[test]
fn legacy_ballistic_saves_keep_midflight_positions_at_the_selected_uniform_speed() {
    let game = with_active(piece(O, 0, 3, 12));
    let rows = 9;
    let distance = f64::from(rows) + 0.375;
    for (difficulty, acceleration) in [
        (None, legacy_gravity_acceleration(1)),
        (
            Some(Difficulty::Challenge),
            gravity_acceleration(Difficulty::Challenge, 1),
        ),
    ] {
        let mut payload = serde_json::to_value(&game).unwrap();
        let fields = payload.as_object_mut().unwrap();
        fields.remove("acceleratedFall");
        match difficulty {
            Some(value) => {
                fields.insert("difficulty".to_owned(), json!(value));
            }
            None => {
                fields.remove("difficulty");
            }
        }
        payload["gravityElapsedMs"] = json!((2.0 * distance / acceleration).sqrt());
        payload["gravityRows"] = json!(rows);
        let restored = Game::restore(&serde_json::to_vec(&payload).unwrap()).unwrap();
        assert_eq!(restored.difficulty, difficulty.unwrap_or_default());
        assert!(!restored.accelerated_fall);
        assert_eq!(restored.active, game.active);
        assert_eq!(restored.gravity_rows, rows);
        assert!(
            (distance - restored.gravity_elapsed_ms / restored.gravity_deadline(1)).abs() < 1e-9
        );
        assert_eq!(
            Game::restore(&serde_json::to_vec(&restored).unwrap()),
            Some(restored)
        );
    }
}

#[test]
fn toggling_gravity_curves_preserves_the_flight_position_and_lock_timer() {
    let mut game = with_active(piece(O, 0, 3, 5));
    game.advance(235.0);
    let prior = game.clone();
    game.set_accelerated_fall(true);
    assert_eq!(game.active, prior.active);
    assert_eq!(game.gravity_rows, 2);
    assert_eq!(game.elapsed_ms, prior.elapsed_ms);
    let distance = 0.5 * standard_gravity(1) * game.gravity_elapsed_ms.powi(2);
    assert!((distance - 2.5).abs() < 1e-9);
    assert_eq!(
        Game::restore(&serde_json::to_vec(&game).unwrap()),
        Some(game.clone())
    );
    game.set_accelerated_fall(false);
    assert!((game.gravity_elapsed_ms - prior.gravity_elapsed_ms).abs() < 1e-9);

    game.active = Some(piece(O, 0, 3, 22));
    game.reset_gravity();
    game.advance(217.0);
    game.set_accelerated_fall(true);
    assert_eq!(game.gravity_elapsed_ms, 0.0);
    assert_eq!(game.lock_remaining_ms, 283.0);
    assert!(has_lock(&game.advance(283.0)));
}

#[test]
fn a_large_time_step_freezes_at_the_exact_top_out_deadline() {
    let mut game = with_active(piece(O, 0, 3, 22));
    game.board[4][4] = T;
    game.advance(99_999.0);
    assert!(game.active.is_none());
    assert_eq!(game.elapsed_ms, LOCK_DELAY_MS);
}

#[test]
fn save_round_trip_restores_hold_bag_score_position_and_fractional_timers() {
    let mut game = Game::new(41212);
    game.advance(800.025);
    game.command(Command::HardDrop);
    game.command(Command::Hold);
    game.advance(201.253);
    game.command(Command::RotateCcw);
    game.command(Command::SoftDrop);
    let saved = serde_json::to_vec(&game).unwrap();
    let mut restored = Game::restore(&saved).unwrap();
    assert_eq!(restored, game);
    for _ in 0..21 {
        assert_eq!(restored.advance(900.0), game.advance(900.0));
        assert_eq!(
            restored.command(Command::HardDrop),
            game.command(Command::HardDrop)
        );
        assert_eq!(restored, game);
        assert!(Game::restore(&serde_json::to_vec(&game).unwrap()).is_some());
    }
}

#[test]
fn incompatible_or_corrupted_saves_are_rejected_before_entangling_live_state() {
    assert!(Game::restore(b"null").is_none());
    assert!(Game::restore(b"{").is_none());
    let valid = serde_json::to_value(Game::new(827)).unwrap();
    for (path, replacement) in [
        ("/version", json!(999)),
        ("/difficulty", json!("invalid")),
        ("/board", json!([])),
        ("/board/20/0", json!(9)),
        ("/board/3/0", json!(1)),
        ("/groups", json!([])),
        ("/groups/20/0", json!(1)),
        ("/nextGroup", json!(0)),
        ("/active/rotation", json!(4)),
        ("/active/x", json!(32767)),
        ("/active/kind", json!(0)),
        ("/next/0", json!(0)),
        ("/bag/rngState", json!(0)),
        ("/bag/cursor", json!(300)),
        ("/bag/pieces", json!([2, 2, 3, 4, 5, 6, 7])),
        ("/elapsedMs", json!(-1)),
        ("/lockResets", json!(16)),
        ("/gravityElapsedMs", json!(1001)),
        ("/gravityRows", json!(u32::MAX)),
        ("/canHold", json!(false)),
    ] {
        let mut invalid = valid.clone();
        *invalid.pointer_mut(path).unwrap() = replacement;
        assert!(
            Game::restore(&serde_json::to_vec(&invalid).unwrap()).is_none(),
            "{path}"
        );
    }
}

#[test]
fn adjacent_pieces_of_the_same_kind_keep_distinct_groups_across_restore() {
    let mut game = with_active(piece(O, 0, 1, 22));
    assert!(matches!(
        game.command(Command::HardDrop).as_slice(),
        [Event::Lock {
            group: 1,
            drop: 0,
            ..
        }]
    ));
    game.active = Some(piece(O, 0, 3, 22));
    assert!(matches!(
        game.advance(LOCK_DELAY_MS).as_slice(),
        [Event::Lock {
            group: 2,
            drop: 0,
            ..
        }]
    ));
    assert_eq!(game.board[22][2..6], [O; 4]);
    assert_eq!(game.groups[22][2..6], [1, 1, 2, 2]);
    assert_eq!(game.groups[23][2..6], [1, 1, 2, 2]);
    assert_eq!(
        Game::restore(&serde_json::to_vec(&game).unwrap()),
        Some(game)
    );
}

#[test]
fn row_compaction_preserves_the_group_of_each_remaining_piece_fragment() {
    let mut game = with_active(piece(I, 1, 2, 20));
    fill_well(&mut game, 22, 2, 4);
    game.board[19][1] = J;
    game.assign_legacy_groups();
    let marker = game.groups[19][1];
    let locked = game.next_group;
    let preceding = game.groups;
    let events = game.advance(LOCK_DELAY_MS);
    assert!(matches!(&events[0], Event::Lock { group, .. } if *group == locked));
    let Event::Clear { cells, groups, .. } = &events[1] else {
        panic!("Expected the completed rows to clear");
    };
    assert_eq!(groups.len(), cells.len());
    for (&[x, y, _], &group) in cells.iter().zip(groups) {
        assert_eq!(group, if x == 4 { locked } else { preceding[y][x] });
    }
    assert_eq!(game.groups[21][1], marker);
    assert_eq!(game.groups[22][4], locked);
    assert_eq!(game.groups[23][4], locked);
    assert_eq!(
        game.groups.iter().flatten().filter(|&&id| id != 0).count(),
        3
    );
    assert_eq!(
        Game::restore(&serde_json::to_vec(&game).unwrap()),
        Some(game)
    );
}

#[test]
fn legacy_save_migrates_cells_individually_and_partial_group_metadata_is_rejected() {
    let mut game = with_active(piece(O, 0, 3, 22));
    game.command(Command::HardDrop);
    let mut payload = serde_json::to_value(&game).unwrap();
    payload.as_object_mut().unwrap().remove("groups");
    assert!(Game::restore(&serde_json::to_vec(&payload).unwrap()).is_none());
    payload.as_object_mut().unwrap().remove("nextGroup");
    let restored = Game::restore(&serde_json::to_vec(&payload).unwrap()).unwrap();
    assert_eq!(restored.board, game.board);
    assert_eq!(restored.active, game.active);
    assert_eq!(restored.groups[22][4..6], [1, 2]);
    assert_eq!(restored.groups[23][4..6], [3, 4]);
    assert_eq!(restored.next_group, 5);
}
