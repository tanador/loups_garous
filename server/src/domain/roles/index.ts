import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

export interface RoleBehavior {}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.resolve(__dirname, '../../../roles.config.json');
const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as {
  registry: Record<string, string>;
  setups: Record<number, Record<string, { min: number; max: number }>>;
};

const isTs = fileURLToPath(import.meta.url).endsWith('.ts');

const registry: Record<string, RoleBehavior> = {};
for (const [name, relTs] of Object.entries(raw.registry)) {
  const rel = isTs
    ? relTs
    : relTs.replace(/^\.\/src\//, './dist/').replace(/\.ts$/, '.js');
  const abs = path.resolve(path.dirname(configPath), rel);
  const spec = './' + path.relative(__dirname, abs).replace(/\\/g, '/');
  const mod = await import(spec);
  registry[name] = (mod.default ?? mod) as RoleBehavior;
}

export const ROLE_REGISTRY = registry;
export type Role = keyof typeof ROLE_REGISTRY;
export const ROLE_SETUPS = raw.setups as Record<number, Record<Role, { min: number; max: number }>>;
