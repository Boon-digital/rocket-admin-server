import type { EntityRegistryEntry } from '../types/registry.js';

// Internal registry — populated by registerConfig() at app startup
let _registry: Record<string, EntityRegistryEntry> = {};

export function registerConfig(registry: Record<string, EntityRegistryEntry>): void {
  _registry = registry;
}

export function getRegistry(): Record<string, EntityRegistryEntry> {
  return _registry;
}
