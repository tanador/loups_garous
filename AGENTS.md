# Repository Guidelines

## Quick Start
- Server: `cd server && npm i && npm run dev`
- Client: `flutter run --dart-define=AUTO_CREATE=true --dart-define=PSEUDO=Alice`

## Environment
- Node >= 20, npm >= 9, TypeScript >= 5.9
- Flutter 3.35.x, Dart 3.9.x
- Windows/Android: Android emulator uses `http://10.0.2.2:3000`

## Project Structure & Module Organization
- `lib/` (Flutter client): UI in `views/`, app state in `state/`, side‑effects in `services/`.
- `server/` (Node.js + TypeScript):
  - `src/infra/` (HTTP/Socket.IO), `src/app/` (orchestrator, timers, schemas), `src/domain/` (rules, FSM, roles, types).
  - `dist/` is transpiled JS. Never edit `dist/` — change `src/` then build.
- Server tests: `server/src/**/__tests__/*.spec.ts`.

## Architecture Overview
Phases (FSM)
```
LOBBY → ROLES → NIGHT_CUPID → NIGHT_LOVERS → NIGHT_WOLVES → NIGHT_WITCH →
MORNING → VOTE → RESOLVE → CHECK_END ──┐
                                       └─(no win)→ NIGHT_WOLVES
                              (win)→ END
```

Key Socket.IO events
- Broadcast: `lobby:updated`, `game:stateChanged`, `game:snapshot`, `day:recap`, `vote:options`, `vote:results`, `game:ended`.
- Commands (ack required): `lobby:create|join|cancel|leave`, `session:resume`, `context:set`,
  `player:ready|unready`, `cupid:choose`, `lovers:ack`, `wolves:chooseTarget`, `witch:decision`,
  `hunter:shoot`, `day:ack`, `vote:cast|vote:cancel`.

Rooms
- Per‑game: `room:<gameId>`; role rooms: `room:<gameId>:wolves`, `room:<gameId>:witch`.
  Private messages (e.g., role assignment) target the player socket id.

Ordering highlights
- MORNING: if a Hunter died at night, his shot resolves before winner evaluation.
- NIGHT_LOVERS: both lovers may `lovers:ack` to end the phase early.

## Build, Test, and Development Commands
- Server
  - `npm run dev` — run TypeScript via ts-node (fast iteration).
  - `npm run build` — transpile to `dist/`.
  - `npm run start` — run built server (`PORT` env, default 3000).
  - `npm run test` — Vitest with coverage. `npm run test:watch` to watch, `npm run test:nocov` to skip coverage.
  - `npm run export:dart` — export enums to the Flutter client (sync roles/FSM).
- Client
  - `flutter run -d windows` or `flutter run -d chrome`.
  - Optional: `--dart-define=AUTO_CREATE=true --dart-define=PSEUDO=Alice`.
  - Default server URL: `http://localhost:3000` (desktop/web) or `http://10.0.2.2:3000` (Android emulator).

## Coding Style & Naming Conventions
- Server (TypeScript): 2‑space indentation, ESLint (`npm run lint`), small layered modules. Filenames kebab‑case (e.g., `orchestrator.ts`). Public APIs typed explicitly.
- Client (Dart): follow `flutter_lints`. Classes in PascalCase, methods/vars in lowerCamelCase. Keep UI logic in `views/`, business logic in `state/`.

## Documentation & Code Comments
- Rédigez du code « auto‑documenté » et commentez suffisamment pour qu’une personne ne connaissant pas l’application comprenne rapidement ce que fait chaque module.
- Ajoutez des commentaires de haut niveau en tête de fichier pour décrire le rôle du fichier (responsabilités, flux principaux, dépendances clés).
- Pour chaque classe/fonction publique, documentez l’intention, les paramètres, la valeur de retour et les effets de bord/erreurs possibles.
- Expliquez les décisions non triviales (choix d’algorithme, hypothèses, contraintes liées au protocole Socket.IO ou au FSM).
- Maintenez la documentation à jour lors des refactors et des changements de règles de jeu (FSM/roles). Si le comportement externe change, mettez à jour les commentaires et le README si nécessaire.
- Préférez des exemples courts et concrets dans les commentaires lorsqu’ils clarifient l’usage (ex.: format des acks, séquence d’évènements lors d’une phase).

## Testing Guidelines
- Vitest on server. Name tests `*.spec.ts` under `__tests__/` near the code.
- Add tests when changing orchestration (wolves, witch, cupid/lovers, hunter, vote, FSM, winners). Prefer deterministic tests (fake timers, fake sockets, no network).
- Run `npm run test` before PRs. Coverage focuses on `src/app` and `src/domain`.

## Agent Workflow & Pre‑handoff Checks
- When you modify the Flutter client, run `flutter analyze` and fix analyzer errors before handing off (common misses: `import 'dart:async';` for `Timer`, unused imports, nullability).
- When you modify the Node/TypeScript server, run `npm run test:nocov` (or `npm run test`) locally to validate core flows.
- Keep changes minimal and focused; do not edit `server/dist/` (build output).
- If you changed roles or FSM enums, run `npm run export:dart` and rebuild the client.

Strong rule for new business logic
- Every time a new functional rule is introduced (e.g., a new role or mechanic), add a dedicated test suite covering:
  - Orchestrator flow across phases (FSM transitions, deadlines).
  - Victory conditions interactions (wolves/village/lovers).
  - Socket.IO contract (events + acks) and role rooms.
  - Edge cases (invalid targets, disconnects, repeats) and negative tests.
  Example: `server/src/app/__tests__/myrole.spec.ts` with fake timers and fake sockets.

## Commit & Pull Request Guidelines
- Commits: short, imperative subject (≤72 chars) + concise body (what/why).
- PRs: summary, rationale, linked issues, and evidence (logs/screens). New business rules MUST include tests and instructions to run them.

## Contribution Checklist
- Lint & tests pass: `npm run lint` (server) and `npm run test`
- New business rules: dedicated tests added (orchestration, winners, sockets)
- Dart export run if roles/FSM change: `npm run export:dart`
- PR includes rationale + logs/screens + run steps

## Security & Configuration Tips
- Socket.IO CORS is permissive for dev; restrict in production.
- Keep ACK contract stable: server acks `{ ok: true, data? } | { ok: false, error }`.
- After role/FSM changes, run `npm run export:dart` and rebuild client.

## Troubleshooting
- Port 3000 busy: run server with `PORT=3001 npm run start` and update client URL.
- CORS blocked in prod: restrict `cors.origin` properly; align client origin.
- Flutter file lock (Windows): close app before `flutter run`/rebuild.
- Android can’t reach `localhost`: use `http://10.0.2.2:3000`.
