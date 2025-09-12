# Configuration des rôles et Deck

Ce document explique comment configurer les rôles et comment le serveur construit le deck et attribue les cartes aux joueurs, y compris l’étape spéciale du Voleur (Nuit 0).

## Fichier `server/roles.config.json`
Un exemple prêt à l’emploi est fourni: `server/roles.config.example.json` (copiez-le en `server/roles.config.json`).

- `registry`: mappe chaque rôle vers son module de logique. Exemple:

```json
{
  "registry": {
    "CUPID": "./src/domain/roles/cupid.ts",
    "WOLF": "./src/domain/roles/wolf.ts",
    "WITCH": "./src/domain/roles/witch.ts",
    "SEER": "./src/domain/roles/seer.ts",
    "HUNTER": "./src/domain/roles/hunter.ts",
    "VILLAGER": "./src/domain/roles/villager.ts",
    "THIEF": "./src/domain/roles/thief.ts"
  },
  "setups": {
    "6": { "WOLF": 1, "CUPID": 1, "WITCH": 1, "HUNTER": 1, "SEER": 1, "THIEF": 1 }
  }
}
```

- `setups`: pour chaque nombre de joueurs N, la COMPOSITION EXACTE du deck: `{ ROLE: nombre_de_cartes }`.
  - Il n’y a plus de min/max.

## Construction du Deck et Attribution

1. Le serveur lit `setups[N]` et construit le deck en répétant la clé `ROLE` le nombre de fois indiqué.
2. Si le deck contient au moins une carte `THIEF`, le serveur ajoute automatiquement 2 cartes `VILLAGER` supplémentaires au deck. Ces deux cartes forment les « cartes du centre ».
3. Le deck complet est mélangé.
4. Le serveur distribue 1 carte par joueur (N cartes) et conserve les 2 restantes (le cas échéant) dans `game.centerCards`.
5. Les cartes du centre ne sont jamais incluses dans les snapshots publics; elles ne sont révélées qu’au Voleur via un événement privé.

Validation: si la taille finale du deck n’est pas conforme (`N` + 2 si THIEF, sinon `N`), l’assignation échoue (`invalid_deck_size`).

## Étape Voleur (Nuit 0)

- `NIGHT_THIEF` est appelée si et seulement si un joueur possède la carte `THIEF` et est vivant/connecté.
- Le serveur émet `thief:wake` au Voleur uniquement:

```jsonc
{
  "center": [ { "role": "WOLF" }, { "role": "VILLAGER" } ]
}
```

- Le Voleur répond par `thief:choose`:
  - `{ action: "keep" }` pour garder sa carte (interdit si les deux cartes du centre sont des `WOLF`)
  - `{ action: "swap", index: 0|1 }` pour échanger sa carte avec `center[index]`

Effets:
- En cas d’échange: le rôle du joueur est mis à jour immédiatement; la carte échangée va au centre; ses rooms Socket.IO sont ajustées (`room:<gameId>:wolves` / `:witch`).
- L’étape se termine par `thief:sleep`, puis la nuit passe à `NIGHT_CUPID`.

Timer: `THIEF_MS` (60s par défaut), surchargeable dans `server/timer.config.json`.

## Exemples de Setup

- 6 joueurs avec Voleur:

```json
{
  "6": { "WOLF": 1, "CUPID": 1, "WITCH": 1, "HUNTER": 1, "SEER": 1, "THIEF": 1 }
}
```

Deck initial (6 cartes) + 2 `VILLAGER` ajoutées (centre) ⇒ 8 cartes. Après mélange, 6 distribuées, 2 au centre.

- 6 joueurs sans Voleur:

```json
{
  "6": { "WOLF": 1, "CUPID": 1, "WITCH": 1, "HUNTER": 1, "SEER": 1, "VILLAGER": 1 }
}
```

Deck de 6 cartes, 0 au centre.

## Notes de Sécurité/UX
- Les cartes du centre ne sont jamais divulguées aux autres joueurs.
- Les logs serveur peuvent contenir des événements « thief.wake/thief.swap » pour le debug; ajuster la verbosité en production si nécessaire.
