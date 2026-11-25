import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LANDING_SETTLE_MS, SUPPORT_SETTLE_MS, dropImpact, fallingLift, flightDuration, landingImpact, landingPose, supportMotion } from './landing'

test('hard drop accelerates continuously and leaves the cushion undeformed until contact', () => {
  const flight = flightDuration(20)
  assert.equal(landingPose(0, 20).lift, 20)
  assert.ok(flight > 300 && flight < 330)
  assert.equal(flightDuration(4), 2 * flightDuration(1))
  const [a, b, c] = [40, 80, 120].map(time => fallingLift(20, time))
  assert.ok(a > b && b > c && b - c > a - b)
  assert.equal(landingPose(flight - 10, 20).squeeze, 0)
  assert.equal(landingPose(flight - 10, 20).bulge, 0)
  assert.equal(landingPose(flight, 20).lift, 0)
  assert.ok(landingPose(flight + 50, 20).squeeze > 0)
  assert.equal(landingPose(flight + LANDING_SETTLE_MS, 20).done, true)
})

test('the rim folds after impact and the filling rebounds close to the floor', () => {
  const impact = dropImpact(12)
  const pressed = landingPose(50, 0, impact)
  assert.equal(pressed.lift, 0)
  assert.ok(pressed.scaleY < 0.92 && pressed.scaleX > 1)
  assert.ok(pressed.squeeze > 0 && landingPose(85, 0, impact).crown < pressed.crown)
  const rebound = landingPose(218, 0, impact)
  assert.ok(rebound.scaleY > 1 && rebound.crown > 0)
  const poses = Array.from({ length: 105 }, (_, frame) => landingPose(frame * 5, 0, impact))
  assert.ok(poses.some(pose => pose.lift > 0.02))
  assert.ok(poses.every(pose => pose.lift < 0.045))
  assert.ok(Math.abs(landingPose(310, 0, impact).scaleY - 1) < (1 - pressed.scaleY) / 4)
  assert.deepEqual(landingPose(LANDING_SETTLE_MS, 0, impact), landingPose(0, 0))
})

test('faster impacts compress more and an off-center stack absorbs some of the rebound', () => {
  const slow = landingImpact(1 / 94)
  const fast = dropImpact(10)
  assert.ok(landingPose(50, 0, slow).squeeze < landingPose(50, 0, fast).squeeze)
  assert.ok(landingPose(50, 0, slow).bulge < landingPose(50, 0, fast).bulge)
  assert.equal(Math.abs(landingPose(50, 0, fast).rock), 0)
  const offCenter = dropImpact(10, true, 0.8)
  const otherSide = dropImpact(10, true, -0.8)
  assert.ok(landingPose(50, 0, offCenter).rock < 0)
  assert.ok(landingPose(50, 0, offCenter).bend > 0.065)
  assert.equal(landingPose(50, 0, otherSide).rock, -landingPose(50, 0, offCenter).rock)
  assert.ok(landingPose(220, 0, offCenter).lift < landingPose(220, 0, fast).lift)
  assert.ok(landingPose(220, 0, offCenter).rock > 0)
})

test('the filling bulges under load and follows a smaller reverse wave', () => {
  const hard = dropImpact(20, true, 1)
  const poses = Array.from({ length: LANDING_SETTLE_MS + 1 }, (_, age) => landingPose(age, 0, hard))
  const peak = Math.max(...poses.map(pose => pose.bulge))
  const recoil = Math.min(...poses.map(pose => pose.bulge))
  assert.equal(poses[0].bulge, 0)
  assert.ok(peak > 0.16 && peak <= 0.20)
  assert.ok(recoil < -0.04 && Math.abs(recoil) < peak / 2)
  assert.equal(poses.at(-1)?.bulge, 0)
})

test('a support yields after contact, then returns with less travel', () => {
  const strength = 0.8
  assert.equal(supportMotion(-1, strength), 0)
  const yieldAtImpact = supportMotion(56, strength)
  const recovery = supportMotion(205, strength)
  assert.ok(yieldAtImpact > strength * 0.9)
  assert.ok(recovery < 0 && Math.abs(recovery) < yieldAtImpact / 3)
  assert.equal(supportMotion(SUPPORT_SETTLE_MS, strength), 0)
})
