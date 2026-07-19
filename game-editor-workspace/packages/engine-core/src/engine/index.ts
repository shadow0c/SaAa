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
//
// [BU TURDA DÜZELTİLEN 2 GERÇEK HATA - physics/index.ts refaktörüyle birlikte]
// 1. [MEMORY LEAK] `removeEntity()` collider'ı ASLA `physics.removeCollider()` ile
//    kaldırmıyordu — silinen bir nesnenin collider'ı sonsuza kadar Octree'de ve
//    `colliders[]` dizisinde YAŞAMAYA devam ediyordu (hem bellek sızıntısı hem de
//    "silinen görünmez bir duvara çarpma" mantık hatası). Düzeltildi.
// 2. [LOGIC ERROR] `updateTransform()` bir BoxCollider'ın `min`/`max`'ını DOĞRUDAN
//    `.copy()` ile mutasyona uğratıyordu. physics/index.ts artık bir Octree
//    kullandığından, bu doğrudan mutasyon Octree'nin uzamsal indeksini BOZAR
//    (collider yanlış oktant'ta aranır, çarpışma testleri sessizce yanlış negatif
//    dönebilir). Artık `physics.updateColliderBounds()` üzerinden geçiyor.

import * as THREE from 'three';
import {
  PhysicsEngine, type Collider, type BoxCollider,
  type CharacterController, type CharacterControllerConfig,
} from '../physics/index.js';
import { RenderEngine } from '../render/index.js';
import { AssetAPI } from '../assets/index.js';

export interface EntityTransform {
  position: { x: number; y: number; z: number };
  rotationY: number; // derece - motor şu an yalnızca Y ekseni rotasyonunu birinci sınıf destekler
  scale: { x: number; y: number; z: number };
}

export type ColliderType = 'box' | 'sphere' | 'capsule' | 'none';

export interface EngineEntity {
  id: string;
  name: string;
  transform: EntityTransform;
  object3D: THREE.Object3D;
  colliderId?: string;
  /** OYUNA ÖZGÜ tüm veri burada yaşar (takım, silah, can, custom flag'ler...). Motor bunun içeriğini bilmez. */
  userData: Record<string, unknown>;
}

export interface SerializedEntity {
  id: string;
  name: string;
  transform: EntityTransform;
  userData: Record<string, unknown>;
}

export interface SerializedScene {
  formatVersion: 1;
  name: string;
  entities: SerializedEntity[];
}

export type EntityFactory = (transform: EntityTransform, userData: Record<string, unknown>) => THREE.Object3D;

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

  private entities = new Map<string, EngineEntity>();
  private colliderByEntity = new Map<string, Collider>();
  private colliderTypeByEntity = new Map<string, ColliderType>();
  private controllerByEntity = new Map<string, CharacterController>();
  private factories = new Map<string, EntityFactory>();

  constructor(gravity = 9.81) {
    this.scene = new THREE.Scene();
    this.physics = new PhysicsEngine(gravity);
    this.render = new RenderEngine();
    this.assets = new AssetAPI();
  }

  /** Oyuna/editöre özgü bir "entity türü" tanımla (ör. 'wall', 'spawnPoint', 'npc', 'coin'...). */
  registerEntityKind(kind: string, factory: EntityFactory) {
    this.factories.set(kind, factory);
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

    const entity: EngineEntity = { id, name, transform: { ...transform }, object3D, userData: { ...userData, __kind: kind } };

    if (solidCollider) {
      const collider = this.physics.addStaticCollider(...this.worldAABBOf(object3D));
      this.colliderByEntity.set(id, collider);
      this.colliderTypeByEntity.set(id, 'box');
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

  private worldAABBOf(object3D: THREE.Object3D): [{ x: number; y: number; z: number }, { x: number; y: number; z: number }] {
    const box = new THREE.Box3().setFromObject(object3D);
    return [
      { x: box.min.x, y: box.min.y, z: box.min.z },
      { x: box.max.x, y: box.max.y, z: box.max.z },
    ];
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
    const colliderType = this.colliderTypeByEntity.get(id);
    if (collider && colliderType === 'box') {
      // [FIX] Doğrudan `.copy()` YERİNE `updateColliderBounds` — Octree'yi de günceller.
      const [min, max] = this.worldAABBOf(object3D);
      this.physics.updateColliderBounds(collider as BoxCollider, min, max);
    } else if (collider && colliderType === 'sphere') {
      const box = new THREE.Box3().setFromObject(object3D);
      const center = box.getCenter(new THREE.Vector3());
      const radius = box.getSize(new THREE.Vector3()).length() / 2;
      this.physics.updateSphereCollider(collider as import('../physics/index.js').SphereCollider, center, radius);
    } else if (collider && colliderType === 'capsule') {
      const box = new THREE.Box3().setFromObject(object3D);
      const size = box.getSize(new THREE.Vector3());
      const radius = Math.max(size.x, size.z) / 2;
      const height = Math.max(0.01, size.y - radius * 2);
      this.physics.updateCapsuleCollider(
        collider as import('../physics/index.js').CapsuleCollider,
        { x: box.min.x + radius, y: box.min.y, z: box.min.z + radius }, height, radius,
      );
    }
  }

  /**
   * YENİ: Inspector'daki "Collider Type Seçimi" (Box/Sphere/Capsule) buradan
   * beslenir. Mevcut collider'ı (varsa, tipi ne olursa olsun) kaldırır ve
   * entity'nin GÜNCEL dünya-uzayı sınırlayıcı kutusundan türetilmiş yeni tipte
   * bir collider ekler.
   */
  setEntityColliderType(id: string, type: ColliderType): Collider | null {
    const entity = this.entities.get(id);
    if (!entity) return null;

    const existing = this.colliderByEntity.get(id);
    if (existing) {
      this.physics.removeCollider(existing);
      this.colliderByEntity.delete(id);
      this.colliderTypeByEntity.delete(id);
    }

    if (type === 'none') return null;

    const box = new THREE.Box3().setFromObject(entity.object3D);
    let collider: Collider;
    if (type === 'box') {
      const [min, max] = this.worldAABBOf(entity.object3D);
      collider = this.physics.addStaticCollider(min, max);
    } else if (type === 'sphere') {
      const center = box.getCenter(new THREE.Vector3());
      const radius = box.getSize(new THREE.Vector3()).length() / 2;
      collider = this.physics.addSphereCollider(center, radius);
    } else {
      const size = box.getSize(new THREE.Vector3());
      const radius = Math.max(size.x, size.z) / 2;
      const height = Math.max(0.01, size.y - radius * 2);
      collider = this.physics.addCapsuleCollider({ x: box.min.x + radius, y: box.min.y, z: box.min.z + radius }, height, radius);
    }

    this.colliderByEntity.set(id, collider);
    this.colliderTypeByEntity.set(id, type);
    entity.colliderId = id;
    return collider;
  }

  getColliderForEntity(id: string): Collider | undefined {
    return this.colliderByEntity.get(id);
  }

  getColliderTypeForEntity(id: string): ColliderType {
    return this.colliderTypeByEntity.get(id) ?? 'none';
  }

  // ------------------------- Character Controller kaydı -------------------------
  // Inspector'daki "Rigidbody/Config Verileri" (mass/radius/height/maxForce/friction)
  // bir entity'ye BAĞLI bir CharacterController örneğini canlı besler.

  attachCharacterController(id: string, config: CharacterControllerConfig): CharacterController {
    const existing = this.controllerByEntity.get(id);
    if (existing) return existing;
    const controller = this.physics.createCharacterController(config);
    this.controllerByEntity.set(id, controller);
    return controller;
  }

  getCharacterController(id: string): CharacterController | undefined {
    return this.controllerByEntity.get(id);
  }

  /** Inspector'daki sayısal alanlar değiştikçe çağrılır - CharacterController.setConfig'e iletir. */
  updateCharacterControllerConfig(id: string, patch: Partial<CharacterControllerConfig>) {
    this.controllerByEntity.get(id)?.setConfig(patch);
  }

  detachCharacterController(id: string) {
    this.controllerByEntity.delete(id);
  }

  removeEntity(id: string) {
    const entity = this.entities.get(id);
    if (!entity) return;
    this.scene.remove(entity.object3D);
    entity.object3D.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry?.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) m?.dispose();
      }
    });

    // [FIX - MEMORY LEAK] Collider'ı fiziksel dünyadan da kaldır - önceki
    // sürümde bu satır YOKTU, silinen nesnelerin collider'ları sonsuza kadar
    // Octree'de kalıp "hayalet duvar" oluşturuyordu.
    const collider = this.colliderByEntity.get(id);
    if (collider) this.physics.removeCollider(collider);
    this.colliderByEntity.delete(id);
    this.colliderTypeByEntity.delete(id);
    this.controllerByEntity.delete(id);

    this.entities.delete(id);
  }

  /** OYUN-BAĞIMSIZ genel JSON çıktısı. Her oyun kendi `userData` şemasını yorumlar. */
  serialize(sceneName = 'Sahne'): SerializedScene {
    return {
      formatVersion: 1,
      name: sceneName,
      entities: [...this.entities.values()].map((e) => ({
        id: e.id, name: e.name, transform: e.transform, userData: e.userData,
      })),
    };
  }

  /** Bir JSON sahnesini yükler. `registerEntityKind` ile tanımlı factory'ler kullanılır. */
  deserialize(data: SerializedScene) {
    for (const id of [...this.entities.keys()]) this.removeEntity(id);
    for (const se of data.entities) {
      const kind = String(se.userData.__kind ?? 'unknown');
      this.createEntity(kind, se.name, se.transform, se.userData);
    }
  }

  dispose() {
    for (const id of [...this.entities.keys()]) this.removeEntity(id);
    this.render.dispose();
    this.assets.dispose();
  }
}
