import 'package:flutter/services.dart'; // pour Clipboard / ClipboardData
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

final playersProvider = StateNotifierProvider<PlayersNotifier, List<String>>(
  (ref) => PlayersNotifier(['Alice', 'Bob']),
);

class PlayersNotifier extends StateNotifier<List<String>> {
  PlayersNotifier(List<String> initial) : super(initial);
  void add(String name) => state = [...state, name];
  void removeAt(int i) {
    final copy = [...state]..removeAt(i);
    state = copy;
  }
  void clear() => state = [];
}

const minPlayers = 5;
const maxPlayers = 12;

String _randomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  final r = Random();
  return List.generate(6, (_) => alphabet[r.nextInt(alphabet.length)]).join();
}

class LobbyScreen extends ConsumerStatefulWidget {
  const LobbyScreen({super.key});
  @override
  ConsumerState<LobbyScreen> createState() => _LobbyScreenState();
}

class _LobbyScreenState extends ConsumerState<LobbyScreen> {
  late String code;

  @override
  void initState() {
    super.initState();
    code = _randomCode();
  }

  @override
  Widget build(BuildContext context) {
    final players = ref.watch(playersProvider);
    final canStart = players.length >= minPlayers && players.length <= maxPlayers;

    return Scaffold(
      appBar: AppBar(title: const Text('Lobby')),
      body: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          children: [
            Card(
              child: ListTile(
                title: const Text('Code de partie'),
                subtitle: Text(code, style: Theme.of(context).textTheme.headlineSmall),
                trailing: IconButton(
                  icon: const Icon(Icons.copy),
                  onPressed: () {
                    Clipboard.setData(ClipboardData(text: code));
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Code copié')),
                    );
                  },
                ),
              ),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Text('Joueurs (${players.length}/$maxPlayers)'),
                const Spacer(),
                FilledButton.tonal(
                  onPressed: players.isEmpty ? null : () => ref.read(playersProvider.notifier).clear(),
                  child: const Text('Vider'),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Expanded(
              child: ListView.builder(
                itemCount: players.length,
                itemBuilder: (context, i) => Dismissible(
                  key: ValueKey('p_$i'),
                  background: Container(color: Colors.red.withOpacity(0.2)),
                  onDismissed: (_) => ref.read(playersProvider.notifier).removeAt(i),
                  child: ListTile(
                    leading: const Icon(Icons.person_outline),
                    title: Text(players[i]),
                    subtitle: const Text('En attente…'),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: FilledButton.tonal(
                    onPressed: players.length >= maxPlayers
                        ? null
                        : () => ref.read(playersProvider.notifier).add('Invité ${players.length + 1}'),
                    child: const Text('Ajouter joueur (test)'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: FilledButton(
                    onPressed: canStart
                        ? () {
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(content: Text('Démarrage avec ${players.length} joueurs')),
                            );
                            // TODO: navigation vers sélection des rôles / jeu
                          }
                        : null,
                    child: const Text('Démarrer'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            if (!canStart)
              Text(
                'Il faut au moins $minPlayers joueurs.',
                style: Theme.of(context).textTheme.bodySmall,
              ),
          ],
        ),
      ),
    );
  }
}
