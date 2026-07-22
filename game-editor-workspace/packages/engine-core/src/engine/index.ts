// src/engine/index.ts
//
// GENEL AMAÇLI MOTOR ÇEKİRDEĞİ. Bu dosya CS2 klonuna ÖZGÜ HİÇBİR ŞEY
// İÇERMEZ — "takım", "silah", "bombsite" gibi oyun-özel kavramlar burada
// YOKTUR, hepsi esnek `userData` içinde saklanır. Bu sayede aynı Engine
// sınıfı; bir FPS, bir yapım (builder) oyunu, bir puzzle oyunu ya da
// editörün kendisi tarafından ortak kullanılabilir.
//
// Physics + Render + Assets + Network API'lerini TEK bir yerde birleştirir;
// hem editör hem de oyun aynı `Engine` örneğini (veya ikisi ayrı örnek
// yaratıp yalnızca `serialize()`/`deserialize()` ile veri paylaşarak) kullanabilir.

import * as THREE from 'three';
import { PhysicsEngine, type BoxCollider } from '../physics/index.js';
import { RenderEngine } from '../render/index.js';
import { AssetAPI } from '../assets/index.js';
import type { ComponentTypeDefinition, EngineComponent } from '../components/index.js';

export interface EntityTransform {
  position: { x: number; y: number; z: number };
  rotationY: number; // derece - motor şu an yalnızca Y ekseni rotasyonunu birinci sınıf destekler
  scale: { x: number; y: number; z: number };
}

export interface EngineEntity {
  id: string;
  name: string;
  transform: EntityTransform;
  object3D: THREE.Object3D;
  colliderId?: string;
  /** OYUNA ÖZGÜ tüm veri burada yaşar (takım, silah, can, custom flag'ler...). Motor bunun içeriğini bilmez. */
  userData: Record<string, unknown>;
  /** Unity/Godot tarzı takılabilir component'ler (CameraSystem3D, Box3D, ...). */
  components: EngineComponent[];
}

export interface SerializedEntity {
  id: string;
  name: string;
  transform: EntityTransform;
  userData: Record<string, unknown>;
  /** entity.colliderId !== undefined mi — genel (oyun-bağımsız) bir bayrak, `userData` içindeki
   *  herhangi bir oyuna-özgü isimlendirmeye (ör. 'solid') bağımlı DEĞİLDİR. */
  hasCollider: boolean;
  components: EngineComponent[];
}

export interface SerializedScene {
  formatVersion: 1;
  name: string;
  entities: SerializedEntity[];
}

export type EntityFactory = (transform: EntityTransform, userData: Record<string, unknown>) => THREE.Object3D;

export interface EngineOptions {
  gravity?: number;
  /**
   * true ise component'lerin editör-içi görsel gizmoları (ör. Box3D'nin tel-
   * kafes kutusu) sahneye eklenir. Oyunun kendisi bunu FALSE bırakmalı —
   * oyuncunun tel-kafes çarpışma kutuları görmesini istemezsin. Editör
   * bunu TRUE bırakır (varsayılan).
   */
  debugVisuals?: boolean;
}

/**
 * Genel amaçlı motor çekirdeği.
 *
 * - Editör bunu kullanarak sahneyi kurar, düzenler, dışa aktarır.
 * - Oyun bunu kullanarak aynı formatı içe aktarır ve gerçek zamanlı çalıştırır.
 * - Her ikisi de aynı `EntityFactory` haritasını (kind -> THREE.Object3D üretici)
 *   paylaşırsa, editörde gördüğün TAM OLARAK oyunda da göreceğin şeydir.
 */
export class Engine {
  public readonly scene: THREE.Scene;
  public readonly physics: PhysicsEngine;
  public readonly render: RenderEngine;
  public readonly assets: AssetAPI;
  public readonly debugVisuals: boolean;

  private entities = new Map<string, EngineEntity>();
  private colliderByEntity = new Map<string, BoxCollider>();
  private factories = new Map<string, EntityFactory>();
  private componentTypes = new Map<string, ComponentTypeDefinition<any>>();

  constructor(gravity = 9.81, options: EngineOptions = {}) {
    this.scene = new THREE.Scene();
    this.physics = new PhysicsEngine(options.gravity ?? gravity);
    this.render = new RenderEngine();
    this.assets = new AssetAPI();
    this.debugVisuals = options.debugVisuals ?? true;
  }

  /** Oyuna/editöre özgü bir "entity türü" tanımla (ör. 'wall', 'spawnPoint', 'npc', 'coin'...). */
  registerEntityKind(kind: string, factory: EntityFactory) {
    this.factories.set(kind, factory);
  }

  // ────────────────────────────────────────────────────────────────────
  //  Component sistemi (Unity/Godot tarzı — bkz. components/index.ts)
  // ────────────────────────────────────────────────────────────────────

  /** Yeni bir component TÜRÜ tanımla (ör. CameraSystem3DComponent, Box3DComponent). */
  registerComponentType(def: ComponentTypeDefinition<any>): void {
    this.componentTypes.set(def.typeId, def);
  }

  getComponentTypeDefs(): ComponentTypeDefinition<any>[] {
    return [...this.componentTypes.values()];
  }

  getComponentTypeDef(typeId: string): ComponentTypeDefinition<any> | undefined {
    return this.componentTypes.get(typeId);
  }

  /** Bir entity'ye component ekler (o türden zaten varsa hiçbir şey yapmaz — entity başına tür başına TEK instance). */
  addComponent(entityId: string, typeId: string): EngineComponent | undefined {
    const entity = this.entities.get(entityId);
    const def = this.componentTypes.get(typeId);
    if (!entity || !def) return undefined;
    if (entity.components.some((c) => c.typeId === typeId)) {
      return entity.components.find((c) => c.typeId === typeId);
    }
    const component: EngineComponent = { typeId, data: def.defaultData() };
    entity.components.push(component);
    def.onSync(entity, component.data, this);
    return component;
  }

  removeComponent(entityId: string, typeId: string): void {
    const entity = this.entities.get(entityId);
    if (!entity) return;
    const idx = entity.components.findIndex((c) => c.typeId === typeId);
    if (idx < 0) return;
    const [component] = entity.components.splice(idx, 1);
    const def = this.componentTypes.get(typeId);
    def?.onDetach?.(entity, component.data, this);
  }

  /** Bir component'in verisini kısmen günceller ve `onSync`'i yeniden çalıştırır (idempotent). */
  updateComponentData(entityId: string, typeId: string, patch: Record<string, unknown>): void {
    const entity = this.entities.get(entityId);
    if (!entity) return;
    const component = entity.components.find((c) => c.typeId === typeId);
    const def = this.componentTypes.get(typeId);
    if (!component || !def) return;
    Object.assign(component.data, patch);
    def.onSync(entity, component.data, this);
  }

  getEntityComponents(entityId: string): EngineComponent[] {
    return this.entities.get(entityId)?.components ?? [];
  }

  createEntity(kind: string, name: string, transform: EntityTransform, userData: Record<string, unknown> = {}, solidCollider = false): EngineEntity {
    const factory = this.factories.get(kind);
    if (!factory) {
      throw new Error(`Engine: "${kind}" için registerEntityKind() ile bir factory tanımlanmadı.`);
    }
    const object3D = factory(transform, userData);
    object3D.position.set(transform.position.x, transform.position.y, transform.position.z);
    object3D.rotation.y = THREE.MathUtils.degToRad(transform.rotationY);
    object3D.scale.set(transform.scale.x, transform.scale.y, transform.scale.z);

    const id = crypto.randomUUID();
    object3D.userData.__engineEntityId = id;
    this.scene.add(object3D);

    const entity: EngineEntity = {
      id, name, transform: { ...transform }, object3D,
      userData: { ...userData, __kind: kind },
      components: [],
    };

    if (solidCollider) {
      const box = new THREE.Box3().setFromObject(object3D);
      const collider = this.physics.addStaticCollider(
        { x: box.min.x, y: box.min.y, z: box.min.z },
        { x: box.max.x, y: box.max.y, z: box.max.z },
      );
      this.colliderByEntity.set(id, collider);
      entity.colliderId = id;
    }

    this.entities.set(id, entity);
    return entity;
  }

  getEntity(id: string): EngineEntity | undefined {
    return this.entities.get(id);
  }

  listEntities(): EngineEntity[] {
    return [...this.entities.values()];
  }

  updateTransform(id: string, transform: Partial<EntityTransform>) {
    const entity = this.entities.get(id);
    if (!entity) return;
    Object.assign(entity.transform, transform);
    const { object3D } = entity;
    object3D.position.set(entity.transform.position.x, entity.transform.position.y, entity.transform.position.z);
    object3D.rotation.y = THREE.MathUtils.degToRad(entity.transform.rotationY);
    object3D.scale.set(entity.transform.scale.x, entity.transform.scale.y, entity.transform.scale.z);

    const collider = this.colliderByEntity.get(id);
    if (collider) {
      const box = new THREE.Box3().setFromObject(object3D);
      collider.min.copy(box.min);
      collider.max.copy(box.max);
    }

    // Box3D gibi ofset-tabanlı component'ler entity dünya konumuna göre
    // konumlanır — entity taşındığında bu component'lerin de yeniden
    // senkronize edilmesi gerekir (aksi halde eski collider konumda "hayalet"
    // bir çarpışma hacmi kalır).
    for (const component of entity.components) {
      const def = this.componentTypes.get(component.typeId);
      def?.onSync(entity, component.data, this);
    }
  }

  removeEntity(id: string) {
    const entity = this.entities.get(id);
    if (!entity) return;

    // Component'leri entity yok edilmeden ÖNCE detach et — aksi halde
    // Box3D'nin collider'ı veya CameraSystem3D'nin aktif-kamera referansı
    // sahne temizlendikten sonra sahipsiz (dangling) kalır.
    for (const component of [...entity.components]) {
      const def = this.componentTypes.get(component.typeId);
      def?.onDetach?.(entity, component.data, this);
    }

    this.scene.remove(entity.object3D);
    entity.object3D.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry?.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) m?.dispose();
      }
    });
    this.colliderByEntity.delete(id);
    this.entities.delete(id);
  }

  /** OYUN-BAĞIMSIZ genel JSON çıktısı. Her oyun kendi `userData` şemasını yorumlar. */
  serialize(sceneName = 'Sahne'): SerializedScene {
    return {
      formatVersion: 1,
      name: sceneName,
      entities: [...this.entities.values()].map((e) => ({
        id: e.id,
        name: e.name,
        transform: e.transform,
        userData: e.userData,
        hasCollider: e.colliderId !== undefined,
        components: e.components.map((c) => ({ typeId: c.typeId, data: { ...c.data } })),
      })),
    };
  }

  /**
   * Bir JSON sahnesini yükler. `registerEntityKind`/`registerComponentType`
   * ile tanımlı factory'ler ve component türleri kullanılır.
   *
   * BUG FIX (kaydet→yükle döngüsünü kıran bir hataydı): önceden `hasCollider`
   * hiç serileştirilmiyordu ve `deserialize()`, `createEntity()`'i HER ZAMAN
   * `solidCollider=false` ile çağırıyordu — yani bir sahneyi kaydedip tekrar
   * yüklemek, TÜM "solid" duvarların çarpışmasını SESSİZCE kaybediyordu.
   * Component'ler de aynı şekilde önceden hiç geri yüklenmiyordu.
   */
  deserialize(data: SerializedScene) {
    for (const id of [...this.entities.keys()]) this.removeEntity(id);
    for (const se of data.entities) {
      const kind = String(se.userData.__kind ?? 'unknown');
      if (!this.factories.has(kind)) {
        // Bilinmeyen tür (ör. oyunun bildiği ama editörün/bu Engine örneğinin
        // registerEntityKind ile hiç tanımlamadığı bir tür) — createEntity()
        // bunun için throw eder; TÜM sahne yüklemesini iptal etmek yerine
        // sadece bu entity'yi atla ve devam et.
        continue;
      }
      const entity = this.createEntity(kind, se.name, se.transform, se.userData, se.hasCollider ?? false);
      for (const c of se.components ?? []) {
        const def = this.componentTypes.get(c.typeId);
        if (!def) continue; // bilinmeyen component türü (ör. eski bir sürümden) — sessizce atla
        const component: EngineComponent = { typeId: c.typeId, data: { ...def.defaultData(), ...c.data } };
        entity.components.push(component);
        def.onSync(entity, component.data, this);
      }
    }
  }

  dispose() {
    for (const id of [...this.entities.keys()]) this.removeEntity(id);
    this.render.dispose();
    this.assets.dispose();
  }
  }
