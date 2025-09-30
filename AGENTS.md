# Repository Guidelines

This document is the contributor guide for this project. It explains structure, how to run and test, and the rules that keep quality high.

## Table of Contents
- Project Structure
- Run / Build / Test
- Coding Style
- Testing
- Architecture (FSM & Sockets)
- Quality & Warnings
- Commit / PR
- Security & Config
- Troubleshooting

## Project Structure
- `lib/` (Flutter client)
  - UI in `views/`, app state in `state/`, side‑effects in `services/`.
- `server/` (Node.js + TypeScript)
  - HTTP/Socket in `src/infra/`, orchestration in `src/app/`, rules/FSM/roles in `src/domain/`.
- Tests live under: `server/src/**/__tests__/*.(spec|test).ts` (prefer `.spec.ts` for new files).

## Run / Build / Test
- Server
  - `npm run dev` — run TS via ts-node (fast dev).
  - `npm run build` — transpile to `dist/` (do not edit `dist/`).
  - `npm start` — run built server (`PORT` env, default 3000).
  - `npm run test` — Vitest with coverage. `npm run test:watch` to watch, `npm run test:nocov` to skip coverage.
  - `npm run export:dart` — export enums to Flutter after FSM/roles change.
- Client
  - `flutter run -d windows` or `flutter run -d chrome`.
  - Optional: `--dart-define=AUTO_CREATE=true --dart-define=PSEUDO=Alice`.
  - Desktop/web default: `http://localhost:3000`; Android emulator: `http://10.0.2.2:3000`.
  - Android release (Play Store): always bump `version: x.y.z+N` in `pubspec.yaml` before building an `.aab`, or pass `--build-number N`. The `+N` is Android `versionCode` and must be unique for each Play upload.

Environment versions are defined in the repo:
- Server: see `server/package.json` (`engines`, deps) and `server/tsconfig.json`.
- Client: see SDK constraint in `pubspec.yaml` and `flutter_lints` version.

## Coding Style
- TypeScript (server)
  - 2‑space indentation. Filenames kebab‑case. Exported/public APIs must be explicitly typed.
  - ESLint is required (`npm run lint`).
- Dart/Flutter (client)
  - Follow `flutter_lints`. Classes in PascalCase; methods/vars lowerCamelCase.
  - Keep UI logic in `views/`, business logic in `state/`.
  - Async UI: do not use `BuildContext` after `await` (capture `ScaffoldMessenger` or check `mounted`).
  - Color API: if your Flutter SDK supports `Color.withValues`, prefer it; otherwise keep `withOpacity` for compatibility.
  - Radios: prefer a single source of truth for selection (parent state). If a shared `RadioGroup<T>` helper exists, use it; otherwise set `groupValue`/`onChanged` on each `RadioListTile` consistently.

## Testing
- Framework: Vitest on server.
- Location: `server/src/**/__tests__/*.(spec|test).ts` (both recognized; prefer `.spec.ts` for new tests).
- Prefer deterministic tests (fake timers/sockets; no real network). Focus coverage on `src/app` and `src/domain` when changing orchestration (wolves, witch, cupid/lovers, hunter, vote, FSM, winners).

Policy “tests first” (agent & contributors)
- Identify impacted behavior and write/adjust tests under `server/src/**/__tests__` before finalizing changes.
- FSM/roles/new rules: mandatory dedicated tests (orchestration, victory conditions, Socket.IO contract, negatives). Example: `server/src/app/__tests__/myrole.spec.ts`.

## Architecture (FSM & Sockets)
High‑level phases: `LOBBY → ROLES → NIGHT_* → MORNING → VOTE → RESOLVE → CHECK_END → (END or back to NIGHT_WOLVES)`.
- Note: Specific night roles (e.g., THIEF, SEER, WOLVES, WITCH) may run in order as defined in `server/src/domain/fsm.ts`.
- Ordering: in `MORNING`, a Hunter shot resolves before the winner evaluation; `NIGHT_LOVERS` can end early when both acks are received.

Key Socket.IO events
- Broadcast: `lobby:updated`, `game:stateChanged`, `game:snapshot`, `day:recap`, `vote:options`, `vote:results`, `game:ended`.
- Commands (ack required): `lobby:create|join|cancel|leave`, `session:resume`, `context:set`, `player:ready|unready`, `cupid:choose`, `lovers:ack`, `wolves:chooseTarget`, `witch:decision`, `hunter:shoot`, `day:ack`, `vote:cast|vote:cancel`.
- Rooms: per‑game `room:<gameId>`; role rooms `room:<gameId>:wolves`, `room:<gameId>:witch`. Private messages target the player socket id.

## Quality & Warnings
- Treat warnings as errors (server and client). The lint scripts are configured to fail on warnings.
- Server: `npm run lint` must be clean; the TypeScript compiler should not report unuseds.
- Client: `flutter analyze` must be clean (remove unused imports, dead code, null‑safety issues).

Checklist before PR
- Lint & tests pass: `npm run lint` and `npm run test`.
- New business rules: dedicated tests added (orchestration, winners, sockets).
- If roles/FSM change: run `npm run export:dart` and rebuild the client; enums are written to `lib/state/generated/enums.dart`.

## Commit / PR
- Commits: short, imperative subject (≤72 chars) + concise body (what/why).
- PRs: include summary, rationale, linked issues, and evidence (logs/screens). New business rules MUST include tests and how to run them.

## Security & Config
- Dev CORS is permissive; restrict for production deployments.
- Keep ACK contract stable: `{ ok: true, data? } | { ok: false, error }`.
- Client Socket.IO logging (`serverLogLevel`): 0 désactive tout, 1 consigne uniquement les erreurs (payload inclus), 2 trace chaque événement avec son payload, 3 se limite au résumé des événements (défaut, les erreurs gardent leur payload).
  - Le niveau se passe au lancement via un dart-define (`--dart-define=_serverLogLevel=2`), un argument CLI (`--serverLogLevel 2`) ou une variable d'environnement (`_serverLogLevel`/`SERVER_LOG_LEVEL`).
  - Valeur lue au démarrage, appliquée à `SocketService` et gardée dans l'état client (pas d'option UI).

## Troubleshooting
- Port 3000 busy: run with `PORT=3001 npm run start` and update client URL.
- CORS blocked in prod: restrict `cors.origin` properly; align client origin.
- Flutter file lock (Windows): close the app before `flutter run`/rebuild.
- Android emulator can’t reach `localhost`: use `http://10.0.2.2:3000`.
- Play Console error "Le code de version X a déjà été utilisé": increment the Android build number (the `+N` in `pubspec.yaml`'s `version`) and rebuild with `flutter build appbundle --release`, or provide a higher `--build-number`.
