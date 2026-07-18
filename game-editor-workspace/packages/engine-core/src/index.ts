// src/index.ts
// @game-engine/core - genel amaçlı motor. Tek tek alt-path importlar da
// mümkündür: '@game-engine/core/physics', '/render', '/network', '/assets'.

export * from './physics/index.js';
export * from './render/index.js';
export * from './network/index.js';
export * from './network/bridge.js';
export * from './assets/index.js';
export * from './engine/index.js';
