// src/network/bridge.ts
//
// EDİTÖR <-> OYUN CANLI İLETİŞİM KÖPRÜSÜ.
//
// Editör ve oyun AYRI REPO'LARDA, ayrı origin/portlarda çalıştığı için
// (BroadcastChannel gibi same-origin API'ler işe yaramaz), küçük bir WebSocket
// "relay" sunucusu (bkz. bridge-server/) üzerinden mesajlaşırlar. Bu dosya,
// motor API'sinin bir parçası olarak HER İKİ TARAF (editör ve oyun) için de
// aynı protokolü tanımlar — böylece "editör oyun içi nesnelerle bağlantılı
// olsun" isteği gerçek bir kanal üzerinden karşılanır, sahte/placeholder değil.
//
// Protokol kasıtlı olarak BASİT tutuldu (JSON mesaj + tip alanı) ki hem editör
// hem de farklı bir oyun projesi kolayca implement edebilsin.

import type { SerializedScene } from '../engine/index.js';

export type BridgeRole = 'editor' | 'game';

export interface BridgeMessage {
  type: 'scene:request' | 'scene:full' | 'scene:entityUpdate' | 'scene:entityAdd' | 'scene:entityRemove' | 'ping' | 'pong';
  role: BridgeRole;
  payload?: unknown;
}

export interface EntityUpdatePayload {
  id: string;
  patch: Record<string, unknown>;
}

/**
 * İki tarafın da (editör / oyun) kullandığı ince WebSocket istemcisi.
 * Sunucu tarafı yok — `bridge-server` yalnızca gelen mesajları diğer
 * bağlı taraflara "relay" eder (yayınlar), iş mantığı burada.
 */
export class EditorGameBridge {
  private ws: WebSocket | null = null;
  private readonly listeners = new Map<BridgeMessage['type'], Set<(msg: BridgeMessage) => void>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = true;

  constructor(private readonly url: string, private readonly role: BridgeRole) {}

  connect() {
    this.shouldReconnect = true;
    this.openSocket();
  }

  private openSocket() {
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.send({ type: 'ping', role: this.role });
    });

    ws.addEventListener('message', (event) => {
      let msg: BridgeMessage;
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return; // bozuk mesaj - sessizce yut, bağlantıyı düşürme
      }
      const handlers = this.listeners.get(msg.type);
      if (handlers) for (const h of handlers) h(msg);
    });

    ws.addEventListener('close', () => {
      if (!this.shouldReconnect) return;
      // Basit sabit-gecikmeli yeniden bağlanma (editör/oyun sunucuyu kaybederse).
      this.reconnectTimer = setTimeout(() => this.openSocket(), 1500);
    });

    ws.addEventListener('error', () => {
      ws.close();
    });
  }

  disconnect() {
    this.shouldReconnect = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  send(message: BridgeMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  on(type: BridgeMessage['type'], handler: (msg: BridgeMessage) => void): () => void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(handler);
    return () => this.listeners.get(type)?.delete(handler);
  }

  // ------------------------- Kolaylık metodları -------------------------

  /** Editör tarafı: oyundan mevcut sahneyi ister. */
  requestScene() {
    this.send({ type: 'scene:request', role: this.role });
  }

  /** Oyun tarafı: editörün istediği (veya kendi başlattığı) tam sahneyi yollar. */
  sendFullScene(scene: SerializedScene) {
    this.send({ type: 'scene:full', role: this.role, payload: scene });
  }

  /** Editör tarafı: bir nesne canlı düzenlendiğinde oyuna anında bildirir. */
  sendEntityUpdate(update: EntityUpdatePayload) {
    this.send({ type: 'scene:entityUpdate', role: this.role, payload: update });
  }

  onSceneFull(handler: (scene: SerializedScene) => void) {
    return this.on('scene:full', (msg) => handler(msg.payload as SerializedScene));
  }

  onEntityUpdate(handler: (update: EntityUpdatePayload) => void) {
    return this.on('scene:entityUpdate', (msg) => handler(msg.payload as EntityUpdatePayload));
  }

  onSceneRequest(handler: () => void) {
    return this.on('scene:request', () => handler());
  }
                   }
