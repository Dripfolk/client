// Renders a single creature on a shared Canvas 2D context.
// Ported from the monolithic index.html into a per-creature class.

import { SHAPES } from '@shared/shapes';
import type { CreatureState } from '@shared/types';
import { applyWalkDeform, applyBreathWave, type LegPair } from './ShapeDeformer';

// ── Helpers ──
function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

// ── Drawing scale ──
const SC = 3;

export class CreatureRenderer {
  // Server target state (updated on network messages)
  private targetX = 0;
  private targetY = 0;
  private targetAngle = 0;
  private targetSpeed = 0;
  private targetWalkPhase = 0;
  private targetBodyScale = 1;

  // Interpolated (rendered) state
  private renderX = 0;
  private renderY = 0;
  private renderAngle = 0;
  private renderSpeed = 0;
  private renderWalkPhase = 0;

  // Local animation state (independent of server)
  private breathTime = 0;
  private blinkTimer = 0;
  private readonly blinkInterval = 4.0;
  private readonly blinkDur = 0.2;

  // Shape data
  private baseBody: readonly [number, number][];
  private eyes: typeof SHAPES['shadow-blob']['eyes'];
  private legs: readonly LegPair[];

  // Whether we have received at least one server update
  private initialized = false;

  readonly id: string;

  constructor(state: CreatureState) {
    this.id = state.id;

    const shape = SHAPES[state.shapeId] ?? SHAPES['shadow-blob'];
    this.baseBody = shape.body;
    this.eyes = shape.eyes;
    this.legs = shape.legs;

    // Snap to initial position (no interpolation on first frame)
    this.applyServerState(state);
    this.renderX = this.targetX;
    this.renderY = this.targetY;
    this.renderAngle = this.targetAngle;
    this.renderSpeed = this.targetSpeed;
    this.renderWalkPhase = this.targetWalkPhase;
    this.initialized = true;

    // Randomize blink offset so creatures don't blink in unison
    this.blinkTimer = Math.random() * this.blinkInterval;
  }

  // ── Server State ──
  applyServerState(state: CreatureState): void {
    this.targetX = state.x;
    this.targetY = state.y;
    this.targetAngle = state.angle;
    this.targetSpeed = state.speed;
    this.targetWalkPhase = state.walkPhase;
    this.targetBodyScale = state.bodyScale;
  }

  // ── Update (called every frame) ──
  update(dt: number): void {
    // Smooth interpolation toward server targets
    // Server sends at 20Hz (50ms), we render at 60fps (~16ms).
    // Use a lerp factor that converges within ~3 server ticks.
    const posLerp = 1 - Math.pow(0.0001, dt); // ~0.15 per frame at 60fps
    const angleLerp = 1 - Math.pow(0.00001, dt);

    this.renderX += (this.targetX - this.renderX) * posLerp;
    this.renderY += (this.targetY - this.renderY) * posLerp;
    this.renderAngle = lerpAngle(this.renderAngle, this.targetAngle, angleLerp);
    this.renderSpeed += (this.targetSpeed - this.renderSpeed) * posLerp;

    // Walk phase: handle wrap-around (0->1 boundary)
    let phaseDiff = this.targetWalkPhase - this.renderWalkPhase;
    if (phaseDiff > 0.5) phaseDiff -= 1;
    if (phaseDiff < -0.5) phaseDiff += 1;
    this.renderWalkPhase = ((this.renderWalkPhase + phaseDiff * posLerp) % 1 + 1) % 1;

    // Local animations
    this.breathTime += dt;
    this.blinkTimer += dt;
  }

  // ── Draw ──
  draw(ctx: CanvasRenderingContext2D): void {
    const sc = SC * this.targetBodyScale;
    const angle = this.renderAngle;
    const ox = this.renderX;
    const oy = this.renderY;
    const speedNorm = this.renderSpeed;

    // Shape pipeline: base -> walk deform -> breath wave
    let pts: [number, number][] = this.baseBody.map(p => [p[0], p[1]]);
    pts = applyWalkDeform(pts, this.renderWalkPhase, speedNorm, this.legs);
    pts = applyBreathWave(pts, this.breathTime, this.legs);

    // Draw body
    this.drawSmoothTransformed(ctx, pts, ox, oy, angle, sc, '#000');

    // Blink openness
    const bc = this.blinkTimer % this.blinkInterval;
    let openness = 1;
    if (bc < this.blinkDur) {
      const half = this.blinkDur / 2;
      openness = bc < half ? 1 - ease(bc / half) : ease((bc - half) / half);
    }

    // Draw eyes
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    for (const eye of this.eyes) {
      const eox = ox + (eye.rel[0] * cosA - eye.rel[1] * sinA) * sc;
      const eoy = oy + (eye.rel[0] * sinA + eye.rel[1] * cosA) * sc;
      this.drawEyeTransformed(ctx, eye.points, eye.centerY, ox, oy, angle, eox, eoy, openness, sc);
    }
  }

  // ── Smooth quadratic bezier curve through points, with rotation ──
  private drawSmoothTransformed(
    ctx: CanvasRenderingContext2D,
    pts: [number, number][],
    ox: number,
    oy: number,
    angle: number,
    sc: number,
    color: string,
  ): void {
    const n = pts.length;
    if (n < 3) return;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    const txFn = (p: [number, number]) => ox + (p[0] * cos - p[1] * sin) * sc;
    const tyFn = (p: [number, number]) => oy + (p[0] * sin + p[1] * cos) * sc;

    ctx.beginPath();

    // Start at midpoint of last->first
    const lx = (pts[n - 1][0] + pts[0][0]) / 2;
    const ly = (pts[n - 1][1] + pts[0][1]) / 2;
    ctx.moveTo(
      ox + (lx * cos - ly * sin) * sc,
      oy + (lx * sin + ly * cos) * sc,
    );

    for (let i = 0; i < n; i++) {
      const cur = pts[i];
      const nxt = pts[(i + 1) % n];
      const mx = (cur[0] + nxt[0]) / 2;
      const my = (cur[1] + nxt[1]) / 2;
      ctx.quadraticCurveTo(
        txFn(cur),
        tyFn(cur),
        ox + (mx * cos - my * sin) * sc,
        oy + (mx * sin + my * cos) * sc,
      );
    }

    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  // ── Eye drawing with blink squish ──
  private drawEyeTransformed(
    ctx: CanvasRenderingContext2D,
    eyePts: readonly [number, number][],
    centerY: number,
    _ox: number,
    _oy: number,
    angle: number,
    eox: number,
    eoy: number,
    openness: number,
    sc: number,
  ): void {
    if (eyePts.length < 3 || openness < 0.01) return;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    // Center eye and apply vertical squish for blink
    const scaled: [number, number][] = new Array(eyePts.length);
    for (let i = 0; i < eyePts.length; i++) {
      scaled[i] = [eyePts[i][0] - 111.5, (eyePts[i][1] - centerY) * openness];
    }

    const n = scaled.length;
    ctx.beginPath();

    const txFn = (p: [number, number]) => eox + (p[0] * cos - p[1] * sin) * sc;
    const tyFn = (p: [number, number]) => eoy + (p[0] * sin + p[1] * cos) * sc;

    const lx = (scaled[n - 1][0] + scaled[0][0]) / 2;
    const ly = (scaled[n - 1][1] + scaled[0][1]) / 2;
    ctx.moveTo(
      eox + (lx * cos - ly * sin) * sc,
      eoy + (lx * sin + ly * cos) * sc,
    );

    for (let i = 0; i < n; i++) {
      const cur = scaled[i];
      const nxt = scaled[(i + 1) % n];
      const mx = (cur[0] + nxt[0]) / 2;
      const my = (cur[1] + nxt[1]) / 2;
      ctx.quadraticCurveTo(
        txFn(cur),
        tyFn(cur),
        eox + (mx * cos - my * sin) * sc,
        eoy + (mx * sin + my * cos) * sc,
      );
    }

    ctx.closePath();
    ctx.fillStyle = '#fff';
    ctx.fill();
  }
}
