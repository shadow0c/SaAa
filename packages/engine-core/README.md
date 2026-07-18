# @game-engine/core

Genel amaçlı, oyun-bağımsız Three.js motor çekirdeği. Herhangi bir web tabanlı
3B oyun (FPS, builder, puzzle, vb.) VE editör bu paketi kullanabilir.

## Neden ayrı bir paket?

Bu motor, hem **editörün** hem de **oyunun** aynı fizik/render/asset/network
mantığını kullanmasını sağlar. Aynı kodun iki yerde ayrı ayrı (ve zamanla
birbirinden sapan) kopyalarının olmasını önler.

## API'ler

```ts
import { Engine, PhysicsEngine, RenderEngine, AssetAPI, EditorGameBridge } from '@game-engine/core';
// veya alt-path importları:
import { PhysicsEngine } from '@game-engine/core/physics';
import { RenderEngine } from '@game-engine/core/render';
import { AssetAPI } from '@game-engine/core/assets';
import { EditorGameBridge } from '@game-engine/core/network/bridge';
```

### `Engine` (genel amaçlı çekirdek)

Oyuna özgü HİÇBİR ŞEY bilmez (takım/silah/can gibi kavramlar yok). Her oyun
kendi "entity kind"lerini `registerEntityKind()` ile tanımlar:

```ts
const engine = new Engine();

engine.registerEntityKind('wall', (transform) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), engine.render.createMaterial('wall', MATERIAL_PRESETS.wall));
  return mesh;
});

const wall = engine.createEntity('wall', 'Duvar 1', {
  position: { x: 0, y: 1, z: 0 }, rotationY: 0, scale: { x: 4, y: 2, z: 0.3 },
}, {}, /* solidCollider */ true);
```

### `PhysicsEngine`

AABB tabanlı statik çarpışma + karakter kontrolcüsü + raycast.
`createCharacterController()` gerçekten çalışan (kendi collider listesine karşı
test eden) bir kontrolcü döner.

### `RenderEngine`

GGX/PBR (Three.js `MeshStandardMaterial` — mikro-yüzey Cook-Torrance BRDF'i
GGX normal dağılımıyla built-in) malzeme ve ışık fabrikası. `MATERIAL_PRESETS`
ile hazır `wall`/`metal`/`plastic` ön ayarları.

### `AssetAPI`

glTF/GLB (Draco destekli) ve doku import + "derleme" raporu (üçgen sayısı,
malzeme sayısı, tahmini doku belleği).

### `EditorGameBridge`

Editör ve oyun arasında CANLI WebSocket iletişimi. İkisi de aynı
`bridge-server`'a bağlanır:

```ts
// Editörde:
const bridge = new EditorGameBridge('ws://localhost:8787', 'editor');
bridge.connect();
bridge.requestScene();
bridge.onSceneFull((scene) => loadIntoViewport(scene));
bridge.sendEntityUpdate({ id: '...', patch: { position: { x: 1, y: 0, z: 0 } } });

// Oyunda:
const bridge = new EditorGameBridge('ws://localhost:8787', 'game');
bridge.connect();
bridge.onSceneRequest(() => bridge.sendFullScene(engine.serialize()));
bridge.onEntityUpdate((update) => engine.updateTransform(update.id, update.patch.transform));
```

## Build

```bash
npm install
npm run build   # -> dist/
```

## Sürüm notu

`three@^0.185.1` ile geliştirildi. `TransformControls`/`OrbitControls`/`GLTFLoader`
importları `three/addons/...` yolundan yapılıyor (three.js'in kendi paket
export map'i). Farklı bir three sürümü kullanıyorsan bu yolları kontrol et.
