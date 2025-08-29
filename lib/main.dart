
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:socket_io_client/socket_io_client.dart' as IO;
import 'package:vibration/vibration.dart';

// ===== Models =====
enum Role { wolf, witch, villager }
enum Phase { lobby, nightWolves, nightWitch, dayVote, ended }

class PlayerInfo {
  final String id;
  final String name;
  final bool alive;
  PlayerInfo({required this.id, required this.name, required this.alive});
  factory PlayerInfo.fromJson(Map<String, dynamic> j) =>
      PlayerInfo(id: j['id'], name: j['name'], alive: j['alive'] ?? true);
}

// ===== Game Client (ChangeNotifier) =====
class GameClient extends ChangeNotifier {
  IO.Socket? _socket;
  String? code;
  String? playerId;
  String? name;
  int capacity = 3;
  Role? role;
  Phase phase = Phase.lobby;
  List<PlayerInfo> players = [];
  List<String> messages = [];
  List<PlayerInfo> actionTargets = []; // for wolves/day
  bool witchCanHeal = false;
  bool witchCanKill = false;
  PlayerInfo? witchVictim;

  String get baseUrl {
    if (Platform.isAndroid) return 'http://10.0.2.2:3000'; // Android emulator → host
    return 'http://localhost:3000';
  }

  void _vibrate5s() async {
    try {
      final can = await Vibration.hasVibrator() ?? false;
      if (can) {
        if (Platform.isAndroid) {
          await Vibration.vibrate(duration: 5000);
        } else {
          // iOS: fallback impacts répétés
          for (int i = 0; i < 5; i++) {
            await HapticFeedback.heavyImpact();
            await Future.delayed(const Duration(milliseconds: 900));
          }
        }
      } else {
        await HapticFeedback.heavyImpact();
      }
    } catch (_) {}
  }

  Future<void> connect() async {
    // Ferme l’ancienne connexion si besoin
    try {
      _socket?.disconnect();
    } catch (_) {}
    _socket = null;

    final s = IO.io(baseUrl, IO.OptionBuilder().setTransports(['websocket']).build());
    _socket = s;

    s.on('connect', (_) {});

    s.on('game_joined', (data) {
      code = data['code'];
      capacity = data['capacity'];
      playerId = data['playerId'];
      messages.add('Rejoint la partie $code');
      notifyListeners();
    });

    s.on('lobby_update', (data) {
      players = (data['players'] as List).map((e) => PlayerInfo.fromJson(e)).toList();
      capacity = data['capacity'];
      if (data['code'] != null) code = data['code'];
      phase = Phase.lobby;
      notifyListeners();
    });

    s.on('role_assign', (data) {
      final r = data['role'];
      if (r == 'wolf') {
        role = Role.wolf;
      } else if (r == 'witch') {
        role = Role.witch;
      } else {
        role = Role.villager;
      }
      messages.add('Votre rôle est: $r');
      _vibrate5s();
      notifyListeners();
    });

    s.on('message', (data) {
      if (data is Map && data['text'] is String) {
        messages.add(data['text']);
        _vibrate5s();
        notifyListeners();
      }
    });

    s.on('start_wolves', (data) {
      actionTargets = (data['targets'] as List).map((e) => PlayerInfo.fromJson(e)).toList();
      phase = Phase.nightWolves;
      notifyListeners();
    });

    s.on('start_witch', (data) {
      witchVictim = PlayerInfo.fromJson(data['victim']);
      witchCanHeal = data['canHeal'] == true;
      witchCanKill = data['canKill'] == true;
      actionTargets = (data['targets'] as List).map((e) => PlayerInfo.fromJson(e)).toList();
      phase = Phase.nightWitch;
      notifyListeners();
    });

    s.on('start_day_vote', (data) {
      actionTargets = (data['targets'] as List).map((e) => PlayerInfo.fromJson(e)).toList();
      phase = Phase.dayVote;
      notifyListeners();
    });

    s.on('day_result', (data) {
      // Optionnel: afficher résultats détaillés
    });

    s.on('game_over', (_) {
      messages.add('Partie terminée.');
      phase = Phase.ended;
      notifyListeners();
    });

    s.on('error_msg', (data) {
      messages.add('Erreur: ${data['text']}');
      notifyListeners();
    });
  }

  // === Actions ===
  void createGame(String pseudo, int cap) {
    name = pseudo;
    capacity = cap;
    connect().then((_) {
      _socket?.emit('create_game', {'name': pseudo, 'capacity': cap});
    });
  }

  void joinGame(String pseudo, String codeInput) {
    name = pseudo;
    connect().then((_) {
      _socket?.emit('join_game', {'name': pseudo, 'code': codeInput.toUpperCase()});
    });
  }

  void wolvesChoose(String targetId) {
    if (code == null || playerId == null) return;
    _socket?.emit('wolves_choose', {'code': code, 'playerId': playerId, 'targetId': targetId});
  }

  void witchDecide({required bool heal, String? killTargetId}) {
    if (code == null) return;
    _socket?.emit('witch_decide', {'code': code, 'heal': heal, 'killTargetId': killTargetId});
  }

  void vote(String targetId) {
    if (code == null || playerId == null) return;
    _socket?.emit('vote', {'code': code, 'playerId': playerId, 'targetId': targetId});
  }
}

final gameProvider = ChangeNotifierProvider<GameClient>((ref) => GameClient());

// ===== UI =====
void main() => runApp(const ProviderScope(child: App()));

class App extends StatelessWidget {
  const App({super.key});
  @override
  Widget build(BuildContext context) {
    final router = GoRouter(routes: [
      GoRoute(path: '/', builder: (_, __) => const EntryScreen()),
      GoRoute(path: '/lobby', builder: (_, __) => const LobbyScreen()),
      GoRoute(path: '/play', builder: (_, __) => const PlayScreen()),
    ]);
    return MaterialApp.router(
      debugShowCheckedModeBanner: false,
      title: 'Loup Garou',
      theme: ThemeData(useMaterial3: true, colorSchemeSeed: Colors.teal),
      darkTheme: ThemeData(useMaterial3: true, colorSchemeSeed: Colors.teal, brightness: Brightness.dark),
      routerConfig: router,
    );
  }
}

class EntryScreen extends ConsumerStatefulWidget {
  const EntryScreen({super.key});
  @override
  ConsumerState<EntryScreen> createState() => _EntryScreenState();
}

class _EntryScreenState extends ConsumerState<EntryScreen> {
  final nameCtrl = TextEditingController();
  final codeCtrl = TextEditingController();
  int capacity = 3;

  @override
  Widget build(BuildContext context) {
    final gc = ref.watch(gameProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Loup Garou — Accueil')),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(controller: nameCtrl, decoration: const InputDecoration(labelText: 'Pseudo')),
                const SizedBox(height: 12),
                Row(children: [
                  Expanded(
                    child: TextField(
                      controller: codeCtrl,
                      decoration: const InputDecoration(labelText: 'Code (pour rejoindre)'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  FilledButton(
                    onPressed: () {
                      gc.joinGame(nameCtrl.text, codeCtrl.text);
                      context.go('/lobby');
                    },
                    child: const Text('Rejoindre'),
                  ),
                ]),
                const Divider(height: 32),
                Row(children: [
                  const Text('Créer (3–6 joueurs) : '),
                  const SizedBox(width: 8),
                  DropdownButton<int>(
                    value: capacity,
                    onChanged: (v) => setState(() => capacity = v ?? 3),
                    items: [3, 4, 5, 6]
                        .map((e) => DropdownMenuItem(value: e, child: Text('$e')))
                        .toList(),
                  ),
                  const Spacer(),
                  FilledButton(
                    onPressed: () {
                      gc.createGame(nameCtrl.text, capacity);
                      context.go('/lobby');
                    },
                    child: const Text('Créer'),
                  )
                ]),
                const SizedBox(height: 16),
                if (gc.code != null) Text('Dernier code: ${gc.code}')
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class LobbyScreen extends ConsumerWidget {
  const LobbyScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final gc = ref.watch(gameProvider);
    final ready = gc.players.length >= gc.capacity && gc.phase != Phase.lobby;
    return Scaffold(
      appBar: AppBar(title: const Text('Lobby')),
      body: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Code: ${gc.code ?? '—'}', style: Theme.of(context).textTheme.headlineSmall),
            Text('Joueurs: ${gc.players.length}/${gc.capacity}'),
            const SizedBox(height: 8),
            Expanded(
              child: ListView.builder(
                itemCount: gc.players.length,
                itemBuilder: (_, i) => ListTile(
                  leading: Icon(gc.players[i].alive ? Icons.person_outline : Icons.person_off_outlined),
                  title: Text(gc.players[i].name),
                ),
              ),
            ),
            FilledButton(
              onPressed: ready ? () => context.go('/play') : null,
              child: const Text('Aller aux instructions'),
            ),
          ],
        ),
      ),
    );
  }
}

class PlayScreen extends ConsumerWidget {
  const PlayScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final gc = ref.watch(gameProvider);

    Widget actionArea() {
      switch (gc.phase) {
        case Phase.nightWolves:
          if (gc.role != Role.wolf) return const Text('Dormez…');
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Loups: choisissez une cible'),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: gc.actionTargets
                    .map((p) => FilledButton.tonal(
                          onPressed: () => ref.read(gameProvider).wolvesChoose(p.id),
                          child: Text(p.name),
                        ))
                    .toList(),
              ),
            ],
          );
        case Phase.nightWitch:
          if (gc.role != Role.witch) return const Text('Dormez…');
          return const WitchPanel();
        case Phase.dayVote:
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Vote du village: choisissez une personne à éliminer'),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: gc.actionTargets
                    .map((p) => FilledButton(
                          onPressed: () => ref.read(gameProvider).vote(p.id),
                          child: Text(p.name),
                        ))
                    .toList(),
              ),
            ],
          );
        case Phase.lobby:
          return const Text('En attente du début…');
        case Phase.ended:
          return const Text('Partie terminée.');
      }
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Instructions & Actions')),
      body: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Rôle: ${gc.role?.name ?? '—'}'),
            const SizedBox(height: 8),
            Expanded(
              child: ListView.builder(
                itemCount: gc.messages.length,
                itemBuilder: (_, i) => Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Text(gc.messages[i]),
                ),
              ),
            ),
            const Divider(),
            actionArea(),
          ],
        ),
      ),
    );
  }
}

class WitchPanel extends ConsumerStatefulWidget {
  const WitchPanel({super.key});
  @override
  ConsumerState<WitchPanel> createState() => _WitchPanelState();
}

class _WitchPanelState extends ConsumerState<WitchPanel> {
  bool heal = false;
  String? killTargetId;

  @override
  Widget build(BuildContext context) {
    final gc = ref.watch(gameProvider);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (gc.witchVictim != null) Text('Victime des loups: ${gc.witchVictim!.name}'),
        const SizedBox(height: 8),
        if (gc.witchCanHeal)
          CheckboxListTile(
            title: const Text('Utiliser potion de vie (sauver la victime)'),
            value: heal,
            onChanged: (v) => setState(() => heal = v ?? false),
          ),
        if (gc.witchCanKill)
          DropdownButtonFormField<String>(
            decoration: const InputDecoration(labelText: 'Potion de mort (cible)'),
            value: killTargetId,
            items: gc.actionTargets
                .map((p) => DropdownMenuItem(value: p.id, child: Text(p.name)))
                .toList(),
            onChanged: (v) => setState(() => killTargetId = v),
          ),
        const SizedBox(height: 8),
        FilledButton(
          onPressed: () => ref.read(gameProvider).witchDecide(heal: heal, killTargetId: killTargetId),
          child: const Text('Valider les choix'),
        )
      ],
    );
  }
}
