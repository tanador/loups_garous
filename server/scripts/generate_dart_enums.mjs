import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

function readRoles() {
  const cfgPath = path.resolve(repoRoot, 'server', 'roles.config.json');
  const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
  const roles = Object.keys(raw.registry);
  roles.sort();
  return roles;
}

function readPhases() {
  const fsmPath = path.resolve(repoRoot, 'server', 'src', 'domain', 'fsm.ts');
  const src = fs.readFileSync(fsmPath, 'utf-8');
  const phases = new Set();
  const start = src.indexOf('const transitions:');
  if (start >= 0) {
    const objStart = src.indexOf('{', start);
    const objEnd = src.indexOf('};', objStart);
    const block = src.slice(objStart + 1, objEnd);
    for (const line of block.split(/\r?\n/)) {
      const m = line.match(/\s*([A-Z_]+)\s*:\s*\[/);
      if (m) phases.add(m[1]);
    }
  }
  return Array.from(phases);
}

function toDartEnum(name) {
  return name; // names already SCREAMING_SNAKE_CASE; Dart allows them in enum identifiers
}

function genDart(roles, phases) {
  const enumRoles = roles.map(toDartEnum).join(', ');
  const enumPhases = phases.map(toDartEnum).join(', ');
  return `// GENERATED FILE - DO NOT EDIT MANUALLY\n// Source: server roles.config.json and domain FSM\n\nimport 'package:flutter/foundation.dart';\n\n// Keep in sync with server/src/domain/fsm.ts transitions keys\nenum GamePhase { ${enumPhases} }\nGamePhase phaseFromStr(String s) => GamePhase.values.firstWhere((e) => describeEnum(e) == s);\n\n// Keep in sync with server/roles.config.json registry keys\nenum Role { ${enumRoles} }\nRole roleFromStr(String s) => Role.values.firstWhere((e) => describeEnum(e) == s);\n`;
}

function main() {
  const roles = readRoles();
  const phases = readPhases();
  const outDir = path.resolve(repoRoot, 'lib', 'state', 'generated');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'enums.dart');
  fs.writeFileSync(outPath, genDart(roles, phases));
  console.log(`[export] Wrote ${outPath} (roles=${roles.length}, phases=${phases.length})`);
}

main();

