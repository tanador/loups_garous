import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../state/game_provider.dart';

// Écran de configuration d'une partie avant de rejoindre le lobby.

class GameOptionsScreen extends ConsumerStatefulWidget {
  final String nickname;
  const GameOptionsScreen({super.key, required this.nickname});

  @override
  ConsumerState<GameOptionsScreen> createState() => _GameOptionsScreenState();
}

class _GameOptionsScreenState extends ConsumerState<GameOptionsScreen> {
  int _maxPlayers = 4; // valeur initiale (3/4/5/6 possibles)

  @override
  Widget build(BuildContext context) {
    final gm = ref.watch(gameProvider);
    final ctl = ref.read(gameProvider.notifier);

    return Scaffold(
      appBar: AppBar(title: const Text('Options de partie')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('Nombre de joueurs'),
          // Sélection du nombre de joueurs autorisés (3 à 6)
          // Note: côté serveur, CreateGameSchema et roles.config.json acceptent
          // maintenant 5 et 6 joueurs; étendre ici expose ces options à l'UI.
          RadioGroup<int>(
            groupValue: _maxPlayers,
            onChanged: (v) => setState(() => _maxPlayers = v ?? 4),
            child: Column(
              children: const [
                RadioListTile<int>(
                  value: 3,
                  title: Text('3 joueurs'),
                ),
                RadioListTile<int>(
                  value: 4,
                  title: Text('4 joueurs'),
                ),
                RadioListTile<int>(
                  value: 5,
                  title: Text('5 joueurs'),
                ),
                RadioListTile<int>(
                  value: 6,
                  title: Text('6 joueurs'),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          ElevatedButton(
            onPressed: gm.socketConnected
                ? () async {
                    final err = await ctl.createGame(widget.nickname, _maxPlayers);
                    if (err != null && context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(backgroundColor: Colors.red, content: Text(err)),
                      );
                    } else if (context.mounted) {
                      Navigator.of(context).pop();
                    }
                  }
                : null,
            child: const Text('Créer'),
          ),
        ]),
      ),
    );
  }
}
