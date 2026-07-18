// server.js
//
// MİNİMAL WebSocket relay: kendi iş mantığı yok, sadece bağlı istemcilere
// (editör + oyun) gelen mesajları birbirine yayınlar. Bu sayede editör ve
// oyun ayrı repo/origin/portlarda olsalar bile canlı konuşabilirler.
//
// Kullanım: node server.js  (varsayılan port 8787, PORT env değişkeniyle değiştirilebilir)

import { WebSocketServer } from 'ws';

const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;
const wss = new WebSocketServer({ port: PORT });

const clients = new Set();

wss.on('connection', (socket) => {
  clients.add(socket);
  console.log(`[bridge] yeni bağlantı (toplam: ${clients.size})`);

  socket.on('message', (data) => {
    // Gelen mesajı gönderen HARİÇ tüm bağlı istemcilere ilet (basit yayın/relay).
    for (const other of clients) {
      if (other !== socket && other.readyState === other.OPEN) {
        other.send(data.toString());
      }
    }
  });

  socket.on('close', () => {
    clients.delete(socket);
    console.log(`[bridge] bağlantı kapandı (kalan: ${clients.size})`);
  });

  socket.on('error', (err) => {
    console.error('[bridge] soket hatası:', err.message);
  });
});

console.log(`[bridge] WebSocket relay dinleniyor: ws://localhost:${PORT}`);
