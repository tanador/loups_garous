import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

import type { Game } from '../types.js';

export interface RoleBehavior {
  onNight?(game: Game): void;
  onVote?(game: Game): void;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.resolve(__dirname, '../../../roles.config.json');
const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as {
  registry: Record<string, string>;
  setups: Record<number, Record<string, { min: number; max: number }>>;
};

const registry: Record<string, RoleBehavior> = {};
for (const [name, rel] of Object.entries(raw.registry)) {
  const abs = path.resolve(path.dirname(configPath), rel);
  const spec = './' + path.relative(__dirname, abs).replace(/\\/g, '/');
  const mod = await import(spec);
  registry[name] = (mod.default ?? mod) as RoleBehavior;
}

export const ROLE_REGISTRY = registry;
export type Role = keyof typeof ROLE_REGISTRY;
export const ROLE_SETUPS = raw.setups as Record<number, Record<Role, { min: number; max: number }>>;
