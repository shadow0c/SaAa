// src/network/index.ts
//
// Motor seviyesinde Network API — oyuncu durumu, olaylar, mesaj yapıları.
// Oyun, bu arayüzü bir WebSocket/REST backend ile impl eder.
// Editör: multiplayer oyun preview'ı için de kullanılabilir.

export interface Vector3Serializable { x: number; y: number; z: number }

export interface PlayerState {
  id: string;
  name: string;
  position: Vector3Serializable;
  rotation: { pitch: number; yaw: number };
  health: number;
  ammo: number;
  activeWeapon: string;
  team: 't' | 'ct';
  isDead: boolean;
}

export interface GameEvent {
  type: 'shot' | 'hit' | 'killed' | 'respawned' | 'chatMessage';
  timestamp: number;
  data: Record<string, unknown>;
}

export interface GameSnapshot {
  tick: number;
  players: PlayerState[];
  events: GameEvent[];
}

export interface NetworkTransport {
  /** Sunucuya bağlan */
  connect(url: string): Promise<void>;
  /** Bağlantıyı kes */
  disconnect(): Promise<void>;
  /** İlişki durumu */
  isConnected(): boolean;
  /** Oyuncu input komutunu gönder */
  sendInput(input: { forward: boolean; backward: boolean; left: boolean; right: boolean; pitch: number; yaw: number; action?: string }): void;
  /** Sunucudan snapshot dinle */
  onSnapshot(handler: (snapshot: GameSnapshot) => void): () => void;
}

export class MockNetworkTransport implements NetworkTransport {
  private connected = false;
  private snapshotListeners: Array<(snapshot: GameSnapshot) => void> = [];

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  sendInput(): void {
    // Mock: şu an hiçbir şey yapmıyor
  }

  onSnapshot(handler: (snapshot: GameSnapshot) => void): () => void {
    this.snapshotListeners.push(handler);
    return () => {
      const idx = this.snapshotListeners.indexOf(handler);
      if (idx > -1) this.snapshotListeners.splice(idx, 1);
    };
  }
}
