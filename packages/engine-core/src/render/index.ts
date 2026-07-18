// src/render/index.ts
//
// Motor seviyesinde Render API — malzeme/ışık/kamera soyutlaması.
// Oyun ve editör her ikisi de bunu kullanır.

import * as THREE from 'three';

export interface MaterialConfig {
  albedo: THREE.Color;
  metalness: number;
  roughness: number;
  normalMap?: THREE.Texture;
  emissive?: THREE.Color;
  emissiveIntensity?: number;
}

export interface LightConfig {
  type: 'point' | 'directional' | 'hemisphere';
  color: THREE.Color;
  intensity: number;
  position?: THREE.Vector3;
  direction?: THREE.Vector3;
  distance?: number;
}

export class RenderEngine {
  private materials = new Map<string, THREE.MeshStandardMaterial>();
  private lights: THREE.Light[] = [];

  /** GGX/PBR malzemesi oluştur (motor soyutlaması) */
  createMaterial(id: string, config: MaterialConfig): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
      color: config.albedo,
      metalness: config.metalness,
      roughness: config.roughness,
      normalMap: config.normalMap,
      emissive: config.emissive,
      emissiveIntensity: config.emissiveIntensity ?? 0,
      side: THREE.DoubleSide,
    });
    this.materials.set(id, mat);
    return mat;
  }

  getMaterial(id: string): THREE.MeshStandardMaterial | undefined {
    return this.materials.get(id);
  }

  /** Işık oluştur (motor soyutlaması) */
  createLight(config: LightConfig): THREE.Light {
    let light: THREE.Light;
    switch (config.type) {
      case 'point':
        light = new THREE.PointLight(config.color, config.intensity, config.distance ?? 100);
        if (config.position) light.position.copy(config.position);
        break;
      case 'directional':
        light = new THREE.DirectionalLight(config.color, config.intensity);
        if (config.direction) light.position.copy(config.direction.normalize().multiplyScalar(50));
        break;
      case 'hemisphere':
      default:
        light = new THREE.HemisphereLight(config.color, new THREE.Color(0x3a3a3a), config.intensity);
        break;
    }
    this.lights.push(light);
    return light;
  }

  dispose() {
    for (const mat of this.materials.values()) mat.dispose();
    this.materials.clear();
    this.lights = [];
  }
}

export const MATERIAL_PRESETS = {
  wall: { albedo: new THREE.Color(0x8a8a8a), metalness: 0.0, roughness: 0.88 },
  metal: { albedo: new THREE.Color(0xcccccc), metalness: 0.95, roughness: 0.22 },
  plastic: { albedo: new THREE.Color(0x2a2a2a), metalness: 0.05, roughness: 0.75 },
} as const;
