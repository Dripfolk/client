// Pure-function shape deformation utilities.
// Ported from index.html walking + breathing pipeline.

export interface LegPair {
  xPos: number;   // normalized body position (-1 tail .. +1 head)
  phase: number;  // metachronal phase offset 0-1
}

// ── Constants ──
const LEG_STRETCH = 10;
const LEG_STRIDE = 5;
const STANCE_DUTY = 0.65;
const LEG_SIGMA = 0.012;

const UNDULATE_AMP = 3;
const UNDULATE_WAVES = 0.8;

const BREATH_SPEED = 0.7;
const BREATH_AMP = 5;
const BREATH_WIDTH = 0.35;

// ── Helpers ──
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ── Walk Deformation ──
// Applies body undulation + individual leg stretch/stride.
// Returns a NEW array (does not mutate input).
export function applyWalkDeform(
  pts: ReadonlyArray<[number, number]>,
  phase: number,
  speedNorm: number,
  legs: ReadonlyArray<LegPair>,
): [number, number][] {
  const out: [number, number][] = new Array(pts.length);

  for (let i = 0; i < pts.length; i++) {
    let px = pts[i][0];
    let py = pts[i][1];
    const bodyPos = px / 75;

    // 1. Body undulation (lateral S-curve), fades near head
    const headFade = clamp01((-bodyPos + 0.8) / 1.2);
    const undulate =
      Math.sin(Math.PI * 2 * (UNDULATE_WAVES * bodyPos - phase)) *
      UNDULATE_AMP *
      speedNorm *
      headFade;
    py += undulate;

    // 2. Per-leg stretch
    for (let li = 0; li < legs.length; li++) {
      const pair = legs[li];
      const dx = bodyPos - pair.xPos;
      const influence = Math.exp(-(dx * dx) / LEG_SIGMA);
      if (influence < 0.01) continue;

      const isTop = py < 0;
      const legPhase = (phase + pair.phase + (isTop ? 0 : 0.5)) % 1;
      const isSwing = legPhase >= STANCE_DUTY;
      const phaseT = isSwing
        ? (legPhase - STANCE_DUTY) / (1 - STANCE_DUTY)
        : legPhase / STANCE_DUTY;

      const sideFactor = clamp01((Math.abs(py) - 15) / 15);

      let stretch: number;
      let forwardReach: number;
      if (isSwing) {
        const peak = Math.sin(phaseT * Math.PI);
        stretch = LEG_STRETCH * peak;
        forwardReach = LEG_STRIDE * 1.5 * ease(phaseT);
      } else {
        const peak = Math.sin(phaseT * Math.PI);
        stretch = -LEG_STRETCH * 0.3 * peak;
        forwardReach = LEG_STRIDE * 1.5 * (1 - phaseT) - LEG_STRIDE * 0.5;
      }

      const inf = influence * sideFactor * speedNorm;
      py += (py > 0 ? stretch : -stretch) * inf;
      px += forwardReach * inf;
    }

    out[i] = [px, py];
  }
  return out;
}

// ── Breathing Wave ──
// Traveling wave head->tail that stretches leg bumps.
export function applyBreathWave(
  pts: ReadonlyArray<[number, number]>,
  t: number,
  legs: ReadonlyArray<LegPair>,
): [number, number][] {
  const xMin = -75;
  const xRange = 150; // xMax - xMin
  const out: [number, number][] = new Array(pts.length);

  for (let i = 0; i < pts.length; i++) {
    let px = pts[i][0];
    let py = pts[i][1];
    const bodyPos = px / 75;
    const norm = 1 - (px - xMin) / xRange;
    const wavePos = (t * BREATH_SPEED) % 1.3 - 0.15;
    const dist = norm - wavePos;

    let bump = 0;
    if (Math.abs(dist) < BREATH_WIDTH) {
      bump = (1 + Math.cos((dist / BREATH_WIDTH) * Math.PI)) / 2;
    }

    // Only stretch actual leg bumps
    let legInfluence = 0;
    for (let li = 0; li < legs.length; li++) {
      const dx = bodyPos - legs[li].xPos;
      legInfluence = Math.max(legInfluence, Math.exp(-(dx * dx) / LEG_SIGMA));
    }

    const tipFactor = clamp01((Math.abs(py) - 15) / 15);
    const stretch = bump * BREATH_AMP * legInfluence * tipFactor;
    py += py > 0 ? stretch : -stretch;

    out[i] = [px, py];
  }
  return out;
}
