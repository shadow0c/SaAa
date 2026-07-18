// src/physics/index.ts
//
// Motor seviyesinde Physics API — oyun ve editör her ikisi de bunu kullanır.
// Uygulama (Cannon.js, Rapier, Three.js manuel) değişebilir, API sabit kalır.
// Editöre: temel çarpışma çok boxlama ve raycasting; oyuna: full hareket, recoil vb.

import * as THREE from 'three';

export interface Vec3Like { x: number; y: number; z: number }

export interface PhysicsRayHit {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
  object?: THREE.Object3D;
}

export interface CharacterController {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  update(dt: number, input: { forward: boolean; backward: boolean; left: boolean; right: boolean }, yaw: number, moveMultiplier: number): void;
  checkCollision(pos: THREE.Vector3): boolean;
}

export interface ColliderShape {
  type: 'box' | 'sphere' | 'capsule';
}

export interface BoxCollider extends ColliderShape {
  type: 'box';
  min: THREE.Vector3;
  max: THREE.Vector3;
}

/**
 * Motor seviyesinde Physics API.
 * Editör: statik kutuları test etmek, karakteri hareket ettirmek
 * Oyun: tam oyuncu kontrolü, granatlar, raycast
 */
export class PhysicsEngine {
  private colliders: BoxCollider[] = [];
  private raycaster = new THREE.Raycaster();

  constructor(private gravity: number = 9.81) {}

  /** Statik çarpışma kutusu ekle (duvar, zemin vb.) */
  addStaticCollider(min: Vec3Like, max: Vec3Like): BoxCollider {
    const collider: BoxCollider = {
      type: 'box',
      min: new THREE.Vector3(min.x, min.y, min.z),
      max: new THREE.Vector3(max.x, max.y, max.z),
    };
    this.colliders.push(collider);
    return collider;
  }

  removeCollider(collider: BoxCollider) {
    const idx = this.colliders.indexOf(collider);
    if (idx > -1) this.colliders.splice(idx, 1);
  }

  getColliders(): Readonly<BoxCollider[]> {
    return Object.freeze([...this.colliders]);
  }

  /** Bir kutuya çarpma testi (kolaylaştırılmış: iki AABB) */
  testAABBCollision(pos: Vec3Like, radius: number, collider: BoxCollider): boolean {
    return (
      pos.x + radius > collider.min.x && pos.x - radius < collider.max.x &&
      pos.y + radius > collider.min.y && pos.y - radius < collider.max.y &&
      pos.z + radius > collider.min.z && pos.z - radius < collider.max.z
    );
  }

  /** Verilen konumda TÜM kayıtlı collider'lara karşı çarpışma var mı? (karakter hareketi bunu kullanır) */
  checkCollisionAt(pos: Vec3Like, radius: number): boolean {
    for (const collider of this.colliders) {
      if (this.testAABBCollision(pos, radius, collider)) return true;
    }
    return false;
  }

  /** Dünya içindeki bir noktada çarpma var mı? (editör seçim, raycasting vb.) */
  raycast(origin: Vec3Like, direction: Vec3Like): PhysicsRayHit | null {
    const o = new THREE.Vector3(origin.x, origin.y, origin.z);
    const d = new THREE.Vector3(direction.x, direction.y, direction.z).normalize();
    this.raycaster.set(o, d);

    // Her collider (AABB) için ray-box intersection testi
    for (const collider of this.colliders) {
      const box = new THREE.Box3(collider.min, collider.max);
      const hit = this.raycaster.ray.intersectBox(box);
      if (hit) {
        const normal = this.estimateBoxNormal(hit, box);
        return { point: hit, normal, distance: hit.distanceTo(o) };
      }
    }
    return null;
  }

  private estimateBoxNormal(point: THREE.Vector3, box: THREE.Box3): THREE.Vector3 {
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    const local = point.clone().sub(center);

    let maxAxis = 0;
    let maxDist = Math.abs(local.x / size.x);
    if (Math.abs(local.y / size.y) > maxDist) { maxAxis = 1; maxDist = Math.abs(local.y / size.y); }
    if (Math.abs(local.z / size.z) > maxDist) maxAxis = 2;

    const normal = new THREE.Vector3();
    if (maxAxis === 0) normal.x = Math.sign(local.x);
    else if (maxAxis === 1) normal.y = Math.sign(local.y);
    else normal.z = Math.sign(local.z);
    return normal;
  }

  /**
   * Bu PhysicsEngine örneğinin collider'larına karşı GERÇEKTEN çarpışan bir
   * karakter kontrolcüsü üretir (önceki taslakta bu fonksiyon serbest/bağımsız
   * bir factory'ydi ve `checkCollision()` HER ZAMAN `false` dönüyordu — hiçbir
   * PhysicsEngine örneğine bağlı olmadığı için gerçek bir çarpışma testi
   * yapamıyordu; bu, karakterin duvarların içinden geçmesi anlamına gelen bir
   * mantık hatasıydı. Şimdi metod PhysicsEngine'e taşındı, `this.colliders`'a
   * doğrudan erişebiliyor.)
   */
  createCharacterController(config: { mass: number; height: number; radius: number; maxForce: number; friction: number }): CharacterController {
    const physics = this;
    const position = new THREE.Vector3(0, config.height, 0);
    const velocity = new THREE.Vector3();

    return {
      position,
      velocity,
      checkCollision(pos: THREE.Vector3): boolean {
        return physics.checkCollisionAt(pos, config.radius);
      },
      update(dt, input, yaw, moveMultiplier) {
        const dz = Number(input.forward) - Number(input.backward);
        const dx = Number(input.right) - Number(input.left);
        const dir = new THREE.Vector3(dx, 0, dz);
        if (dir.lengthSq() < 1e-6) return;
        dir.normalize();

        const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
        const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
        const force = new THREE.Vector3()
          .addScaledVector(forward, dir.z * config.maxForce * moveMultiplier)
          .addScaledVector(right, dir.x * config.maxForce * moveMultiplier);

        // Üstel sürtünme entegrasyonu: v' = v*e^(-k dt) + (F/k)*(1 - e^(-k dt))
        const k = config.friction / config.mass;
        const exponent = Math.exp(-k * dt);
        velocity.x = velocity.x * exponent + (force.x / config.friction) * (1 - exponent);
        velocity.z = velocity.z * exponent + (force.z / config.friction) * (1 - exponent);

        const nextX = position.clone(); nextX.x += velocity.x * dt;
        if (!physics.checkCollisionAt(nextX, config.radius)) position.x = nextX.x;

        const nextZ = position.clone(); nextZ.z += velocity.z * dt;
        if (!physics.checkCollisionAt(nextZ, config.radius)) position.z = nextZ.z;
      },
    };
  }
}
