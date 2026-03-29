// Manages the Colyseus connection to the server.

import { Client, Room } from 'colyseus.js';
import type { CreatureState } from '@shared/types';

export interface NetworkCallbacks {
  onCreatureAdd: (id: string, state: CreatureState) => void;
  onCreatureRemove: (id: string) => void;
  onCreatureChange: (id: string, state: CreatureState) => void;
}

const MOUSE_SEND_INTERVAL = 1000 / 20; // 20Hz

export class NetworkManager {
  private client: Client;
  private room: Room | null = null;
  private callbacks: NetworkCallbacks | null = null;
  private connected = false;

  // Mouse send throttling
  private lastMouseSendTime = 0;
  private pendingMouseX = 0;
  private pendingMouseY = 0;
  private mouseDirty = false;

  // Reconnection
  private reconnectTimer: number | null = null;
  private reconnectDelay = 1000;
  private readonly maxReconnectDelay = 10000;

  constructor(private serverUrl: string = 'ws://localhost:2567') {
    this.client = new Client(this.serverUrl);
  }

  setCallbacks(callbacks: NetworkCallbacks): void {
    this.callbacks = callbacks;
  }

  async connect(): Promise<void> {
    try {
      console.log(`[Network] Connecting to ${this.serverUrl}...`);
      this.room = await this.client.joinOrCreate('world');
      this.connected = true;
      this.reconnectDelay = 1000;
      console.log('[Network] Connected to room:', this.room.id);

      this.setupRoomListeners();
    } catch (err) {
      console.warn('[Network] Connection failed:', err);
      this.scheduleReconnect();
    }
  }

  private setupRoomListeners(): void {
    if (!this.room) return;

    // Listen for creature state via the schema callback pattern.
    // Colyseus 0.15 uses onChange$ / onAdd$ on MapSchema, but
    // the exact API depends on how the server defines its schema.
    // We use the generic state listener approach that works with
    // both Schema-based and plain state.

    this.room.onStateChange((state: any) => {
      // Full state snapshot — iterate creatures map
      if (!state?.creatures) return;
      // This fires on every state patch from the server
    });

    // Listen to the creatures MapSchema
    this.room.state?.creatures?.onAdd?.((creature: any, id: string) => {
      this.callbacks?.onCreatureAdd(id, this.extractCreatureState(creature, id));

      // Listen for changes on this creature
      creature.onChange?.(() => {
        this.callbacks?.onCreatureChange(id, this.extractCreatureState(creature, id));
      });
    });

    this.room.state?.creatures?.onRemove?.((_creature: any, id: string) => {
      this.callbacks?.onCreatureRemove(id);
    });

    // If creatures are already present (late join)
    if (this.room.state?.creatures) {
      this.room.state.creatures.forEach((creature: any, id: string) => {
        this.callbacks?.onCreatureAdd(id, this.extractCreatureState(creature, id));

        creature.onChange?.(() => {
          this.callbacks?.onCreatureChange(id, this.extractCreatureState(creature, id));
        });
      });
    }

    this.room.onLeave((code: number) => {
      console.log('[Network] Disconnected, code:', code);
      this.connected = false;
      this.room = null;
      if (code !== 1000) {
        // Abnormal close — try reconnecting
        this.scheduleReconnect();
      }
    });

    this.room.onError((code: number, message?: string) => {
      console.error('[Network] Room error:', code, message);
    });
  }

  private extractCreatureState(creature: any, id: string): CreatureState {
    return {
      id,
      ownerId: creature.ownerId ?? '',
      name: creature.name ?? '',
      x: creature.x ?? 0,
      y: creature.y ?? 0,
      angle: creature.angle ?? 0,
      speed: creature.speed ?? 0,
      walkPhase: creature.walkPhase ?? 0,
      mood: creature.mood ?? 0,
      currentAction: creature.currentAction ?? 0,
      shapeId: creature.shapeId ?? 'shadow-blob',
      bodyScale: creature.bodyScale ?? 1.0,
    };
  }

  // ── Mouse Position Sending ──
  sendMousePosition(x: number, y: number): void {
    this.pendingMouseX = x;
    this.pendingMouseY = y;
    this.mouseDirty = true;
  }

  // Called from game loop to flush throttled mouse data
  flushMouse(): void {
    if (!this.mouseDirty || !this.connected || !this.room) return;

    const now = performance.now();
    if (now - this.lastMouseSendTime < MOUSE_SEND_INTERVAL) return;

    this.lastMouseSendTime = now;
    this.mouseDirty = false;

    this.room.send('mouse', {
      x: Math.round(this.pendingMouseX),
      y: Math.round(this.pendingMouseY),
    });
  }

  // ── Reconnection ──
  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;

    console.log(`[Network] Reconnecting in ${this.reconnectDelay}ms...`);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);

    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }

  get isConnected(): boolean {
    return this.connected;
  }

  disconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.room?.leave();
    this.room = null;
    this.connected = false;
  }
}
