import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.resolve(__dirname, '../../../roles.config.json');
const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const registry = {};
for (const [name, rel] of Object.entries(raw.registry)) {
    const abs = path.resolve(path.dirname(configPath), rel);
    const spec = './' + path.relative(__dirname, abs).replace(/\\/g, '/');
    const mod = await import(spec);
    registry[name] = (mod.default ?? mod);
}
export const ROLE_REGISTRY = registry;
export const ROLE_SETUPS = raw.setups;
//# sourceMappingURL=index.js.map