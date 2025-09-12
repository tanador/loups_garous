import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

export interface RoleBehavior {}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.resolve(__dirname, '../../../roles.config.json');
const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as {
  registry: Record<string, string>;
  setups: Record<number, Record<string, number>>;
};

const isTs = fileURLToPath(import.meta.url).endsWith('.ts');

export type Role = keyof typeof raw.registry;

export let ROLE_REGISTRY: Record<Role, RoleBehavior>;
export const ROLE_REGISTRY_READY: Promise<void> = (async () => {
  const entries = await Promise.all(
    Object.entries(raw.registry).map(async ([name, relTs]) => {
      const rel = isTs
        ? relTs
        : relTs.replace(/^\.\/src\//, './dist/').replace(/\.ts$/, '.js');
      const abs = path.resolve(path.dirname(configPath), rel);
      const spec = './' + path.relative(__dirname, abs).replace(/\\/g, '/');
      const mod = await import(spec);
      return [name, (mod.default ?? mod) as RoleBehavior] as const;
    })
  );
  ROLE_REGISTRY = Object.fromEntries(entries) as Record<Role, RoleBehavior>;
})();

// New format: setups define the deck composition as exact counts per role
export const ROLE_SETUPS = raw.setups as Record<number, Record<Role, number>>;
