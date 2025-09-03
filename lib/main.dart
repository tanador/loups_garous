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
import 'state/models.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const ProviderScope(child: App()));
}

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

    if (!me.alive) return const DeadScreen();

    if (s.gameId == null) return const ConnectScreen();

    // Phase-based routing
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
      case GamePhase.END:
        return const EndScreen();
      case GamePhase.LOBBY:
      case GamePhase.RESOLVE:
      case GamePhase.CHECK_END:
      default:
        return const WaitingLobby();
    }
  }
}

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

class WaitingLobby extends ConsumerWidget {
  const WaitingLobby({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(gameProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Salle d’attente')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Text('Partie ${s.gameId} • joueurs: ${s.players.where((p) => p.alive).length}/3'),
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
            const Text('En attente du démarrage automatique à 3 joueurs...')
          ],
        ),
      ),
    );
  }
}
