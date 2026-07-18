// src/EditorViewport.ts
//
// Bu dosya editörün "motoru KULLANDIĞI" yerdir — motoru yeniden yazmaz.
// `@game-engine/core`'dan Engine (Physics+Render+Assets birleşimi) ve
// EditorGameBridge (Network) import edilip DOĞRUDAN kullanılıyor.
//
// Açılışta klasik bir oyun motoru gibi: güneş (DirectionalLight) + geniş boş
// bir taban (ground plane) gösterilir. Oradan itibaren küp/nesne/asset
// eklenebilir.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import {
  Engine, MATERIAL_PRESETS, EditorGameBridge,
  type EntityTransform, type EngineEntity, type SerializedScene,
} from '@game-engine/core';

export type ShaderPreset = keyof typeof MATERIAL_PRESETS; // 'wall' | 'metal' | 'plastic'

export interface EditorEntityUserData {
  __kind: 'box' | 'spawnPoint' | 'bombsite' | 'light' | 'model';
  shader?: ShaderPreset;
  color?: string;
  metalness?: number;
  roughness?: number;
  team?: 't' | 'ct';
  label?: string;
  intensity?: number;
  distance?: number;
  assetId?: string;
  assetName?: string;
  solid?: boolean;
}

const TEAM_COLOR = { t: 0xd9822b, ct: 0x2b6fd9 } as const;

export class EditorViewport {
  public readonly engine: Engine;
  public bridge: EditorGameBridge | null = null;

  private renderer!: THREE.WebGLRenderer;
  private camera!: THREE.PerspectiveCamera;
  private orbit!: OrbitControls;
  private transformControls!: TransformControls;
  private ground!: THREE.Mesh;

  private raycaster = new THREE.Raycaster();
  private pointerNDC = new THREE.Vector2();
  private pointerDownPos = { x: 0, y: 0 };
  private rafId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;

  public onSelectionChange: ((entity: EngineEntity | null) => void) | null = null;
  public onSceneChange: (() => void) | null = null;

  private selectedId: string | null = null;

  constructor() {
    this.engine = new Engine();
    this.registerEntityKinds();
  }

  mount(container: HTMLElement) {
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    this.renderer.setClearColor(0x87ceeb, 1); // açık gökyüzü mavisi - "klasik motor açılış ekranı" hissi
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
    this.camera.position.set(14, 11, 14);
    this.camera.lookAt(0, 0, 0);

    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.target.set(0, 0, 0);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;

    this.setupDefaultScene();
    this.setupTransformControls();
    this.attachDomListeners();
    this.observeResize(container);
    this.loop();
  }

  unmount() {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.resizeObserver?.disconnect();
    this.detachDomListeners();
    this.transformControls?.dispose();
    this.bridge?.disconnect();
    this.engine.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  /** Her oyun motorunda görülen klasik açılış: güneş + boş bir taban. */
  private setupDefaultScene() {
    // Güneş: yönlü ışık (DirectionalLight) - motorun RenderEngine API'si üzerinden.
    const sun = this.engine.render.createLight({
      type: 'directional',
      color: new THREE.Color(0xfff4e0),
      intensity: 2.2,
      direction: new THREE.Vector3(20, 30, 10),
    });
    this.engine.scene.add(sun);

    const ambient = this.engine.render.createLight({
      type: 'hemisphere',
      color: new THREE.Color(0xffffff),
      intensity: 0.7,
    });
    this.engine.scene.add(ambient);

    // Taban: geniş, düz, sonsuz görünümlü boş taban.
    const groundMat = this.engine.render.createMaterial('ground', {
      albedo: new THREE.Color(0x6b8f5a), metalness: 0.0, roughness: 0.95,
    });
    const groundGeo = new THREE.PlaneGeometry(300, 300);
    this.ground = new THREE.Mesh(groundGeo, groundMat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.engine.scene.add(this.ground);

    const grid = new THREE.GridHelper(300, 150, 0x333333, 0x2a4a2a);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.35;
    this.engine.scene.add(grid);

    this.engine.scene.fog = new THREE.Fog(0x87ceeb, 80, 260);
  }

  /** Editörün varsayılan entity türleri: kutu, spawn point, bombsite, ışık, model. */
  private registerEntityKinds() {
    this.engine.registerEntityKind('box', (_transform, userData) => {
      const ud = userData as EditorEntityUserData;
      const preset = MATERIAL_PRESETS[ud.shader ?? 'wall'];
      const mat = this.engine.render.createMaterial(`box-${crypto.randomUUID()}`, {
        albedo: new THREE.Color(ud.color ?? '#8a8f98'),
        metalness: ud.metalness ?? preset.metalness,
        roughness: ud.roughness ?? preset.roughness,
      });
      mat.transparent = !ud.solid;
      mat.opacity = ud.solid ? 1 : 0.55;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return mesh;
    });

    this.engine.registerEntityKind('spawnPoint', (_t, userData) => {
      const ud = userData as EditorEntityUserData;
      const team = ud.team ?? 't';
      const group = new THREE.Group();
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(0.4, 1.2, 12),
        new THREE.MeshStandardMaterial({ color: TEAM_COLOR[team], emissive: TEAM_COLOR[team], emissiveIntensity: 0.4 }),
      );
      cone.position.y = 0.6;
      group.add(cone);
      return group;
    });

    this.engine.registerEntityKind('bombsite', (_t, userData) => {
      const ud = userData as EditorEntityUserData;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(2.85, 3, 32),
        new THREE.MeshBasicMaterial({ color: 0xff3b30, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.userData.__label = ud.label ?? 'A';
      return ring;
    });

    this.engine.registerEntityKind('light', (_t, userData) => {
      const ud = userData as EditorEntityUserData;
      const group = new THREE.Group();
      const point = new THREE.PointLight(new THREE.Color(ud.color ?? '#ffe0b0'), ud.intensity ?? 2, ud.distance ?? 15);
      group.add(point);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 12), new THREE.MeshBasicMaterial({ color: ud.color ?? '#ffe0b0' }));
      group.add(bulb);
      return group;
    });

    this.engine.registerEntityKind('model', (_t, userData) => {
      const ud = userData as EditorEntityUserData;
      const clone = ud.assetId ? this.engine.assets.instantiateModel(ud.assetId) : null;
      return clone ?? new THREE.Group();
    });
  }

  // ------------------------------------------------------------ GIZMO/ORBIT --

  private setupTransformControls() {
    const controls = new TransformControls(this.camera, this.renderer.domElement);
    controls.setSize(0.9);
    const maybeGetHelper = (controls as unknown as { getHelper?: () => THREE.Object3D }).getHelper;
    if (typeof maybeGetHelper === 'function') {
      this.engine.scene.add(maybeGetHelper.call(controls));
    } else {
      this.engine.scene.add(controls as unknown as THREE.Object3D);
    }
    controls.addEventListener('dragging-changed', (e: { value: unknown }) => { this.orbit.enabled = !e.value; });
    controls.addEventListener('objectChange', () => {
      if (this.selectedId) this.pushLiveUpdateForSelected();
    });
    this.transformControls = controls;
  }

  setTransformMode(mode: 'translate' | 'rotate' | 'scale') {
    this.transformControls.setMode(mode);
  }

  private loop = () => {
    this.orbit.update();
    this.renderer.render(this.engine.scene, this.camera);
    this.rafId = requestAnimationFrame(this.loop);
  };

  private observeResize(container: HTMLElement) {
    this.resizeObserver = new ResizeObserver(() => {
      const w = container.clientWidth, h = container.clientHeight;
      if (!w || !h) return;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    });
    this.resizeObserver.observe(container);
  }

  // ------------------------------------------------------------- SELECTION --

  private onPointerDown = (e: PointerEvent) => { this.pointerDownPos = { x: e.clientX, y: e.clientY }; };

  private onPointerUp = (e: PointerEvent) => {
    const moved = Math.hypot(e.clientX - this.pointerDownPos.x, e.clientY - this.pointerDownPos.y);
    const dragging = (this.transformControls as unknown as { dragging?: boolean }).dragging;
    if (moved > 5 || dragging) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointerNDC, this.camera);

    const targets = this.engine.listEntities().map((en) => en.object3D);
    const hits = this.raycaster.intersectObjects(targets, true);
    if (hits.length === 0) { this.select(null); return; }
    let obj: THREE.Object3D | null = hits[0].object;
    while (obj && !obj.userData.__engineEntityId && obj.parent) obj = obj.parent;
    this.select((obj?.userData.__engineEntityId as string) ?? null);
  };

  private attachDomListeners() {
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp);
  }
  private detachDomListeners() {
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp);
  }

  select(id: string | null) {
    this.selectedId = id;
    const entity = id ? this.engine.getEntity(id) : null;
    if (entity) this.transformControls.attach(entity.object3D);
    else this.transformControls.detach();
    this.onSelectionChange?.(entity ?? null);
  }

  // ------------------------------------------------------------ ENTITY OPS --

  private spawnPositionInFront(distance = 5): THREE.Vector3 {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
    dir.normalize();
    const p = this.camera.position.clone().addScaledVector(dir, distance);
    p.y = 0.5;
    return p;
  }

  private defaultTransform(y = 0.5): EntityTransform {
    const p = this.spawnPositionInFront();
    return { position: { x: p.x, y, z: p.z }, rotationY: 0, scale: { x: 1, y: 1, z: 1 } };
  }

  addBox(solid: boolean, shader: ShaderPreset = 'wall') {
    const entity = this.engine.createEntity('box', solid ? 'Duvar/Kutu' : 'Prop', {
      ...this.defaultTransform(0.5), scale: { x: 2, y: 2, z: 2 },
    }, { __kind: 'box', shader, color: '#8a8f98', solid } satisfies EditorEntityUserData, solid);
    this.select(entity.id);
    this.onSceneChange?.();
    return entity;
  }

  addSpawnPoint(team: 't' | 'ct') {
    const entity = this.engine.createEntity('spawnPoint', team === 't' ? 'T Spawn' : 'CT Spawn', this.defaultTransform(0.05),
      { __kind: 'spawnPoint', team } satisfies EditorEntityUserData);
    this.select(entity.id);
    this.onSceneChange?.();
    return entity;
  }

  addBombsite(label: string) {
    const entity = this.engine.createEntity('bombsite', `Bombsite ${label}`, this.defaultTransform(0.02),
      { __kind: 'bombsite', label } satisfies EditorEntityUserData);
    this.select(entity.id);
    this.onSceneChange?.();
    return entity;
  }

  addLight() {
    const t = this.defaultTransform(3);
    const entity = this.engine.createEntity('light', 'Işık', t,
      { __kind: 'light', color: '#ffe0b0', intensity: 2, distance: 15 } satisfies EditorEntityUserData);
    this.select(entity.id);
    this.onSceneChange?.();
    return entity;
  }

  addModelInstance(assetId: string, assetName: string) {
    const entity = this.engine.createEntity('model', assetName, this.defaultTransform(0),
      { __kind: 'model', assetId, assetName } satisfies EditorEntityUserData);
    this.select(entity.id);
    this.onSceneChange?.();
    return entity;
  }

  removeSelected() {
    if (!this.selectedId) return;
    this.engine.removeEntity(this.selectedId);
    this.select(null);
    this.onSceneChange?.();
  }

  updateSelectedTransform(patch: Partial<EntityTransform>) {
    if (!this.selectedId) return;
    this.engine.updateTransform(this.selectedId, patch);
    this.pushLiveUpdateForSelected();
    this.onSceneChange?.();
  }

  updateSelectedUserData(patch: Partial<EditorEntityUserData>) {
    if (!this.selectedId) return;
    const entity = this.engine.getEntity(this.selectedId);
    if (!entity) return;
    Object.assign(entity.userData, patch);
    // Görsel materyali/ışığı yeniden kur (basit yol: entity'yi aynı transform'la yeniden yarat).
    const kind = String(entity.userData.__kind);
    const transform = entity.transform;
    const name = entity.name;
    this.engine.removeEntity(this.selectedId);
    const fresh = this.engine.createEntity(kind, name, transform, entity.userData, Boolean(entity.userData.solid));
    this.select(fresh.id);
    this.onSceneChange?.();
  }

  // ------------------------------------------------------------------ BRIDGE --

  connectBridge(url: string) {
    const bridge = new EditorGameBridge(url, 'editor');
    bridge.connect();
    bridge.onSceneFull((scene) => this.loadSceneFromGame(scene));
    this.bridge = bridge;
    return bridge;
  }

  requestSceneFromGame() {
    this.bridge?.requestScene();
  }

  private loadSceneFromGame(scene: SerializedScene) {
    for (const se of scene.entities) {
      const kind = String(se.userData.__kind ?? 'box');
      if (!['box', 'spawnPoint', 'bombsite', 'light', 'model'].includes(kind)) continue;
      this.engine.createEntity(kind, se.name, se.transform, se.userData, Boolean((se.userData as EditorEntityUserData).solid));
    }
    this.onSceneChange?.();
  }

  private pushLiveUpdateForSelected() {
    if (!this.bridge?.isConnected() || !this.selectedId) return;
    const entity = this.engine.getEntity(this.selectedId);
    if (!entity) return;
    this.bridge.sendEntityUpdate({ id: entity.id, patch: { transform: entity.transform } });
  }

  exportScene() {
    return this.engine.serialize('Editör Sahnesi');
  }
}
