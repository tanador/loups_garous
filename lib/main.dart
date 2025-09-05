import 'dart:developer';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'state/game_provider.dart';
import 'views/connect_screen.dart';
import 'views/role_screen.dart';
import 'views/countdown_screen.dart';
import 'views/night_wolves_screen.dart';
import 'views/night_witch_screen.dart';
import 'views/morning_screen.dart';
import 'views/vote_screen.dart';
import 'views/end_screen.dart';
import 'views/dead_screen.dart';
import 'views/hunter_screen.dart';
import 'state/models.dart';

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
    final gm = ref.watch(gameProvider);
    return MaterialApp(
      title: 'Loup-Garou',
      theme: ThemeData(useMaterial3: true, brightness: Brightness.light),
      darkTheme: ThemeData(useMaterial3: true, brightness: Brightness.dark),
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
    final isOwner = s.players.isNotEmpty && s.players.first.id == s.playerId;
    return Scaffold(
      appBar: AppBar(title: const Text('Salle d’attente')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Text('Partie ${s.gameId} • joueurs: ${s.players.where((p) => p.alive).length}/${s.maxPlayers}'),
            const SizedBox(height: 12),
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
                try {
                  await (isOwner ? ctl.cancelGame() : ctl.leaveGame());
                } catch (e, st) {
                  log('leave/cancel exception: $e', stackTrace: st);
                } finally {
                  if (context.mounted) {
                    Navigator.of(context).popUntil((route) => route.isFirst);
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
