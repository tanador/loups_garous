# Loup Garou

[![Server CI](https://github.com/tanador/loup_garou/actions/workflows/server.yml/badge.svg)](https://github.com/tanador/loup_garou/actions/workflows/server.yml)
[![Flutter CI](https://github.com/tanador/loup_garou/actions/workflows/flutter.yml/badge.svg)](https://github.com/tanador/loup_garou/actions/workflows/flutter.yml)

Projet d'apprentissage autour du jeu du **Loup-Garou**.  Il contient :

- une application Flutter dans le dossier `lib/`
  - `state/` gère l'état global du jeu via Riverpod
  - `services/` regroupe les accès externes (Socket.IO)
  - `views/` contient les différents écrans de l'interface
- un serveur Node.js/Socket.IO dans le dossier `server/`
  - `domain/` implémente les règles métiers et la logique de partie
  - `app/` orchestre les événements et conserve l'état des parties
  - `infra/` expose les transports HTTP et WebSocket

Ce dépôt peut servir de base pour comprendre l'organisation d'une petite
application temps réel Flutter ↔ Node.js.

## Rôle « Voleur » et Deck (Nuit 0)

Le serveur construit un deck réel à partir de `server/roles.config.json` (nouveau format):

- `registry`: rôles disponibles et leur module.
- `setups[N]`: pour chaque nombre de joueurs N, la COMPOSITION EXACTE du deck `{ ROLE: nombre }` (il n’y a plus de min/max).

Attribution et centre:
- Si le deck contient au moins une carte `THIEF`, le serveur ajoute automatiquement 2 cartes `VILLAGER` au deck; ces 2 cartes sont placées « au centre » (face cachée) après distribution.
- Mélange du deck complet, distribution de 1 carte par joueur (N cartes), puis les cartes restantes (0 ou 2) deviennent `game.centerCards`.

Nuit 0 — Voleur (`NIGHT_THIEF`):
- Le Voleur reçoit un réveil privé `thief:wake { center: [{role},{role}] }`.
- Il envoie `thief:choose { action: 'keep' | 'swap', index?: 0|1 }`.
- Contrainte officielle: si les 2 cartes du centre sont `WOLF`, le Voleur ne peut pas « garder » et doit échanger.
- Après échange, son rôle change immédiatement (rooms Socket.IO mises à jour), et la nuit continue vers Cupidon (`NIGHT_CUPID`).

Timers: `THIEF_MS` (configurable via `server/timer.config.json`).

Plus de détails et des exemples de configuration: voir `server/ROLES.md`.

## Intégration Continue (CI)

- Server CI (Node/TypeScript)
  - Installe les dépendances (`npm ci`), lance le typecheck (`tsc --noEmit`), le lint (ESLint), puis les tests (Vitest).
  - Fichier: `.github/workflows/server.yml`.
- Flutter CI (client)
  - Installe Flutter stable, restaure le cache pub, exécute `flutter pub get`, `flutter analyze`, et `flutter test`.
  - Fichier: `.github/workflows/flutter.yml`.

Résultat: chaque push et PR déclenche ces jobs. Les badges ci‑dessus affichent l’état actuel.

## Types/Énumérations partagés (générés)

Les énumérations partagées (phases du jeu et rôles) sont générées depuis le serveur afin d’éviter les divergences.

- Générer côté client Dart à partir du serveur:
  - `cd server && npm run export:dart`
  - Produit `lib/state/generated/enums.dart` (GamePhase, Role, et convertisseurs). Le client l’importe et le ré‑exporte depuis `lib/state/models.dart`.

Note: Pour aller plus loin, vous pouvez étendre la génération aux schémas d’entrées (Zod) en exportant du JSON Schema (via `zod-to-json-schema`) et en générant des modèles Dart (ex. quicktype). Cette étape n’est pas nécessaire pour faire tourner le projet.

## Démarrage rapide

Vous aurez besoin de l'outil de ligne de commande Flutter et de Node.js.

1. lancez le serveur Node dans `server/` (`npm install && npm run dev`)
2. démarrez ensuite l'application Flutter (`flutter run`)

Pour plus d'aide sur Flutter consultez
[la documentation officielle](https://docs.flutter.dev/) qui propose
des tutoriels et une référence complète de l'API.

### Paramètres de lancement

Il est possible de pré-remplir le pseudonyme et de lancer
automatiquement une partie lors du démarrage. Pour cela utilisez des
variables de compilation :

```bash
flutter run \
  --dart-define=PSEUDO=MonPseudo \
 --dart-define=AUTO_CREATE=true
```

`PSEUDO` renseigne le surnom utilisé et `AUTO_CREATE=true` crée
immédiatement une partie de 4 joueurs après la connexion.
