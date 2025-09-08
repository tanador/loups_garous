// -----------------------------------------------------------------------------
// Application Flutter du jeu Loup-Garou.
//
// Organisation :
// - "state/" contient la logique et les modèles de données exposés via Riverpod.
// - "services/" regroupe les accès externes (ici la couche Socket.IO).
// - "views/" rassemble les écrans représentant chaque phase du jeu.
// -----------------------------------------------------------------------------

import 'dart:developer';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'state/game_provider.dart';
import 'views/connect_screen.dart';
import 'views/countdown_screen.dart';
import 'views/night_wolves_screen.dart';
import 'views/night_witch_screen.dart';
import 'views/night_cupid_screen.dart';
import 'views/night_lovers_screen.dart';
import 'views/morning_screen.dart';
import 'views/vote_screen.dart';
import 'views/end_screen.dart';
import 'views/dead_screen.dart';
import 'views/hunter_screen.dart';
import 'state/models.dart';
import 'views/widgets/player_badge.dart';

// Point d'entrée de l'application Flutter.
// Initialise les widgets puis démarre l'application
// sous un `ProviderScope` pour activer Riverpod.
void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const ProviderScope(child: App()));
}

/// Widget racine de l'application.
/// Il configure le thème et prépare la navigation
/// en fonction de l'état global du jeu exposé par Riverpod.
class App extends ConsumerWidget {
  const App({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    ref.watch(gameProvider);
    return MaterialApp(
      title: 'Loup-Garou',
      theme: ThemeData(useMaterial3: true, brightness: Brightness.light),
      darkTheme: ThemeData(useMaterial3: true, brightness: Brightness.dark),
      // Injecte un overlay global pour afficher le pseudo du joueur
      // sur tous les écrans lorsqu'une partie est en cours.
      builder: (context, child) => _WithGlobalOverlay(child: child),
      home: _HomeRouter(),
    );
  }
}

class _HomeRouter extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(gameProvider);
    final youRole = s.role;
    final phase = s.phase;
    final me = s.players.firstWhere(
        (p) => p.id == s.playerId,
        orElse: () => const PlayerView(id: '', connected: true, alive: true));

    // Toujours afficher l'écran de fin lorsque la partie est terminée,
    // même si le joueur local est mort.
    if (phase == GamePhase.END) return const EndScreen();

    // Si le chasseur est appelé à tirer, afficher l'écran dédié
    // même si la mort n'a pas encore été synchronisée côté client.
    if (s.role == Role.HUNTER && s.hunterTargets.isNotEmpty) {
      return const HunterScreen();
    }

    // Les joueurs morts voient l'écran des défunts.
    if (!me.alive) {
      return const DeadScreen();
    }

    // Aucune partie jointe: afficher l'écran de connexion.
    if (s.gameId == null) return const ConnectScreen();

    // Route vers l'écran approprié selon la phase de jeu courante.
    switch (phase) {
      case GamePhase.ROLES:
        return const CountdownScreen();
      case GamePhase.NIGHT_CUPID:
        if (youRole == Role.CUPID) return const NightCupidScreen();
        return const SleepingPlaceholder(title: 'Nuit', subtitle: 'Fermez les yeux');
      case GamePhase.NIGHT_LOVERS:
        if (s.loverPartnerId != null) return const NightLoversScreen();
        return const SleepingPlaceholder(title: 'Nuit', subtitle: 'Fermez les yeux');
      case GamePhase.NIGHT_WOLVES:
        if (youRole == Role.WOLF) return const NightWolvesScreen();
        return const SleepingPlaceholder(title: 'Nuit', subtitle: 'Fermez les yeux');
      case GamePhase.NIGHT_WITCH:
        if (youRole == Role.WITCH) return const NightWitchScreen();
        return const SleepingPlaceholder(title: 'Nuit', subtitle: 'Fermez les yeux');
      case GamePhase.MORNING:
        return const MorningScreen();
      case GamePhase.VOTE:
        return const VoteScreen();
      case GamePhase.LOBBY:
      case GamePhase.RESOLVE:
      case GamePhase.CHECK_END:
      default:
        return const WaitingLobby();
    }
  }
}

/// Affiche un écran simpliste pendant que le joueur "dort"
/// lors des phases de nuit auxquelles il ne participe pas.
class SleepingPlaceholder extends StatelessWidget {
  final String title;
  final String subtitle;
  const SleepingPlaceholder({super.key, required this.title, required this.subtitle});
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: Center(child: Text(subtitle, style: const TextStyle(fontSize: 20))),
    );
  }
}

/// Salle d'attente affichée avant le début de la partie.
/// Les joueurs connectés y sont listés et l'hôte peut annuler la partie.
class WaitingLobby extends ConsumerWidget {
  const WaitingLobby({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(gameProvider);
    final ctl = ref.read(gameProvider.notifier);
    final isOwner = s.isOwner;
    // Si aucun snapshot n'a été reçu, déclenche une resynchronisation
    if (!s.hasSnapshot && s.gameId != null && s.playerId != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        ctl.ensureSynced();
      });
    }
    return Scaffold(
      appBar: AppBar(title: const Text('Salle d’attente')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            if (!s.hasSnapshot) ...[
              Text('Partie ${s.gameId} • synchronisation...'),
            ] else ...[
              Text('Partie ${s.gameId} • joueurs: ${s.players.where((p) => p.alive).length}/${s.maxPlayers}')
            ],
            const SizedBox(height: 12),
            if (!s.hasSnapshot)
              const Expanded(child: Center(child: CircularProgressIndicator()))
            else
              Expanded(
                child: ListView(
                  children: s.players
                      .map((p) => ListTile(
                            title: Text(p.id),
                            subtitle: Text(p.alive ? 'Vivant' : 'Mort'),
                            trailing: Icon(p.connected ? Icons.wifi : Icons.wifi_off),
                          ))
                      .toList(),
                ),
              ),
            const SizedBox(height: 12),
            ElevatedButton(
              onPressed: () async {
                String? err;
                try {
                  err = await (isOwner ? ctl.cancelGame() : ctl.leaveGame());
                } catch (e, st) {
                  err = e.toString();
                  log('leave/cancel exception: $err', stackTrace: st);
                } finally {
                  if (context.mounted) {
                    if (err != null) {
                      ScaffoldMessenger.of(context)
                          .showSnackBar(SnackBar(backgroundColor: Colors.red, content: Text(err)));
                    }
                    // Pas de navigation nécessaire : le routeur principal
                    // réaffichera automatiquement l'écran de connexion
                    // puisque l'état a été réinitialisé.
                  }
                }
              },
              child: Text(isOwner ? 'Annuler la partie' : 'Quitter la partie'),
            ),
            const SizedBox(height: 12),
            Text('En attente du démarrage automatique à ${s.maxPlayers} joueurs...')
          ],
        ),
      ),
    );
  }
}

/// Enveloppe globale pour ajouter un overlay persistant (ex: pseudo du joueur)
/// au-dessus de toutes les vues de l'application.
class _WithGlobalOverlay extends ConsumerWidget {
  final Widget? child;
  const _WithGlobalOverlay({this.child});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(gameProvider);
    final overlay = const PlayerBadge();
    return Stack(
      children: [
        // Contenu principal (Navigator)
        Positioned.fill(child: child ?? const SizedBox.shrink()),
        // Overlay global (affiché uniquement lorsqu'une partie est rejointe)
        IgnorePointer(
          ignoring: true,
          child: AnimatedOpacity(
            opacity: s.gameId != null ? 1.0 : 0.0,
            duration: const Duration(milliseconds: 150),
            child: const PlayerBadge(),
          ),
        ),
      ],
    );
  }
}
