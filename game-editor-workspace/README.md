# game-editor-workspace

Bu repo **oyundan tamamen ayrıdır** — oyuncular buna erişemez, oyunun
deploy edildiği yerde bu kod hiç bulunmaz. Üç paketten oluşan bir npm
workspace:

```
packages/
├── engine-core/    @game-engine/core  - genel amaçlı motor (Physics/Render/Assets/Network API'leri)
├── editor-app/     UE5/Unity tarzı editör UI (Vite + React), motoru KULLANIR
└── bridge-server/  Editör <-> Oyun canlı WebSocket relay'i
```

`engine-core`, kendi başına ayrı bir repo/paket olarak da yayınlanabilecek
şekilde tasarlandı (bağımsız `package.json`, kendi `dist/` çıktısı,
oyuna-özgü hiçbir şey içermiyor) — istersen ileride `packages/engine-core`'u
buradan çıkarıp kendi repo'suna taşıyabilirsin, hiçbir kod değişikliği
gerekmez.

## Kurulum

```bash
npm install          # workspace'teki 3 paketi de kurar ve birbirine bağlar
npm run build:engine # @game-engine/core'u derler (editor-app buna ihtiyaç duyar)
```

## Çalıştırma

**1) Bridge relay sunucusunu başlat** (editör ve oyunun konuşabilmesi için):
```bash
npm run dev:bridge
# -> ws://localhost:8787 üzerinde dinler
```

**2) Editörü başlat:**
```bash
npm run dev:editor
# -> http://localhost:5180
```

**3) Oyun tarafında** (ayrı repo, `bana-s-js-arcade-main`), oyunun da aynı
bridge'e bağlanması gerekir — bkz. oyun repo'sundaki `src/lib/game/editorBridgeClient.ts`
(bu turda oyun repo'suna da eklendi). Oyun çalışırken editördeki
**"Oyundan Sahneyi Çek"** butonuna basarsan, oyunun `MAP_WALLS` verisi
editöre canlı olarak akar; editörde bir nesneyi taşıdığında da (bridge
bağlıyken) oyuna anlık güncelleme gider.

Üçünü birden başlatan kısayol:
```bash
npm run dev
```

## Açılış sahnesi

Editör ilk açıldığında (her motorda olduğu gibi): bir güneş
(`DirectionalLight`) + geniş boş bir taban (`ground plane` + grid) görürsün.
"+ Ekle" menüsünden küp, spawn point, bombsite, ışık ekleyebilir; glTF/GLB
model veya doku import edebilirsin.

## Sürüm notu

`three@^0.185.1`, `TransformControls`/`OrbitControls`/`GLTFLoader` importları
`three/addons/...` yolundan. Bu sohbette canlı web erişimim olmadığı için tam
API şeklini (özellikle `TransformControls.getHelper()` ayrımını) çalışma
zamanında doğrulayamadım — `engine-core/src/physics` ve `editor-app/src/EditorViewport.ts`
feature-detection ile savunmacı yazıldı, ama `npm install` sonrası ilk
denemede konsolu kontrol et.
