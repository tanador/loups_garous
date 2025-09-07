# Loup Garou

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
