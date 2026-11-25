export interface LandingPose {
  lift: number
  scaleX: number
  scaleY: number
  squeeze: number
  bulge: number
  crown: number
  bend: number
  rock: number
  done: boolean
}

export type LandingImpact = { strength: number; onStack: boolean; offset: number }

const REST: LandingPose = { lift: 0, scaleX: 1, scaleY: 1, squeeze: 0, bulge: 0, crown: 0, bend: 0, rock: 0, done: true }
const FALL_ACCELERATION = 0.0004 // cells per millisecond squared
export const LANDING_SETTLE_MS = 520
export const CLEAR_CONTACT_MS = 176
export const SUPPORT_SETTLE_MS = 420
export const STACK_PRESS_MS = 142

export function flightDuration(rows: number) {
  return Math.sqrt(2 * Math.max(0, rows) / FALL_ACCELERATION)
}

export function fallingLift(rows: number, ageMs: number) {
  const time = Math.max(0, ageMs)
  return Math.max(0, rows - 0.5 * FALL_ACCELERATION * time * time)
}

export function landingImpact(speed: number, onStack = false, offset = 0): LandingImpact {
  return { strength: speed / (speed + 0.018), onStack, offset: Math.max(-1, Math.min(1, offset)) }
}

export function dropImpact(rows: number, onStack = false, offset = 0) {
  return landingImpact(FALL_ACCELERATION * flightDuration(rows), onStack, offset)
}

function dampedResponse(age: number, halfPeriod: number, decay: number, end: number) {
  if (age <= 0 || age >= end) return 0
  const tail = Math.min(1, (end - age) / 72)
  return Math.sin(Math.PI * age / halfPeriod) * Math.exp(-age / decay) * tail ** 2 * (3 - 2 * tail)
}

export function landingPose(ageMs: number, dropRows: number, impact = dropImpact(dropRows)): LandingPose {
  const flight = flightDuration(dropRows)
  if (ageMs < flight) return { ...REST, lift: fallingLift(dropRows, ageMs), done: false }
  const { strength, onStack, offset } = impact
  if (ageMs >= flight + LANDING_SETTLE_MS || strength === 0) return REST
  const age = ageMs - flight

  // The filling compresses at the base first. The upper rim follows a little later.
  const body = 1.53 * strength * dampedResponse(age, onStack ? 151 : 137, 136, LANDING_SETTLE_MS)
  const cap = 1.7 * strength * dampedResponse(age - 32, 159, 115, LANDING_SETTLE_MS - 32)
  const sway = offset * (0.62 * body + 0.38 * cap)
  const rise = Math.max(0, -body)

  return {
    lift: (onStack ? 0.058 : 0.12) * rise,
    scaleX: 1 + 0.068 * body,
    scaleY: 1 - 0.135 * body,
    squeeze: (onStack ? 0.105 : 0.056) * Math.max(0, body),
    bulge: Math.max(-0.075, Math.min(0.20, 0.205 * body + 0.02 * cap)),
    crown: -0.235 * cap,
    rock: -(onStack ? 0.10 : 0.062) * sway,
    bend: 0.18 * sway,
    done: false,
  }
}

export function supportMotion(age: number, strength: number) {
  return 1.83 * strength * dampedResponse(age, 144, 111, SUPPORT_SETTLE_MS)
}
