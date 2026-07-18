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
  private colliderByEntity = new Map<string, BoxCollider>();
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
    this.colliderByEntity.delete(id);
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
