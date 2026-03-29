// Main game controller.
// Manages the canvas, creature renderers, and the render loop.

import type { CreatureState } from '@shared/types';
import { CreatureRenderer } from './CreatureRenderer';
import { NetworkManager } from './NetworkManager';

export class Game {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;

  private creatures: Map<string, CreatureRenderer> = new Map();
  private network: NetworkManager;

  // Mouse position in world coordinates
  private mouseX = 0;
  private mouseY = 0;

  // Timing
  private prevTimestamp = 0;
  private running = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context not available');
    this.ctx = ctx;

    this.network = new NetworkManager('ws://localhost:2567');
    this.network.setCallbacks({
      onCreatureAdd: this.onCreatureAdd.bind(this),
      onCreatureRemove: this.onCreatureRemove.bind(this),
      onCreatureChange: this.onCreatureChange.bind(this),
    });

    this.setupEvents();
    this.resize();
  }

  // ── Lifecycle ──
  async start(): Promise<void> {
    this.running = true;
    this.prevTimestamp = performance.now();
    await this.network.connect();
    requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    this.network.disconnect();
  }

  // ── Events ──
  private setupEvents(): void {
    window.addEventListener('resize', this.resize);

    window.addEventListener('mousemove', (e: MouseEvent) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.network.sendMousePosition(this.mouseX, this.mouseY);
    });

    window.addEventListener('touchmove', (e: TouchEvent) => {
      if (e.touches.length > 0) {
        this.mouseX = e.touches[0].clientX;
        this.mouseY = e.touches[0].clientY;
        this.network.sendMousePosition(this.mouseX, this.mouseY);
      }
    }, { passive: true });
  }

  private resize = (): void => {
    this.width = this.canvas.width = window.innerWidth;
    this.height = this.canvas.height = window.innerHeight;
  };

  // ── Network Callbacks ──
  private onCreatureAdd(id: string, state: CreatureState): void {
    if (this.creatures.has(id)) return;
    const renderer = new CreatureRenderer(state);
    this.creatures.set(id, renderer);
    console.log(`[Game] Creature added: ${id}`);
  }

  private onCreatureRemove(id: string): void {
    this.creatures.delete(id);
    console.log(`[Game] Creature removed: ${id}`);
  }

  private onCreatureChange(id: string, state: CreatureState): void {
    const renderer = this.creatures.get(id);
    if (renderer) {
      renderer.applyServerState(state);
    }
  }

  // ── Render Loop ──
  private frame = (timestamp: number): void => {
    if (!this.running) return;

    const dt = Math.min((timestamp - this.prevTimestamp) / 1000, 0.05);
    this.prevTimestamp = timestamp;

    // Flush throttled mouse data
    this.network.flushMouse();

    // Update all creatures
    for (const creature of this.creatures.values()) {
      creature.update(dt);
    }

    // Clear & draw
    this.ctx.clearRect(0, 0, this.width, this.height);

    for (const creature of this.creatures.values()) {
      creature.draw(this.ctx);
    }

    // Status overlay when disconnected
    if (!this.network.isConnected) {
      this.drawConnectionStatus();
    }

    requestAnimationFrame(this.frame);
  };

  private drawConnectionStatus(): void {
    this.ctx.save();
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    this.ctx.fillRect(0, 0, this.width, this.height);
    this.ctx.fillStyle = '#fff';
    this.ctx.font = '24px monospace';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('Connecting to server...', this.width / 2, this.height / 2);
    this.ctx.restore();
  }
}
