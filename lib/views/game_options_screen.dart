import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../state/game_provider.dart';
import '../utils/snackbars.dart';

// Écran de configuration d'une partie avant de rejoindre le lobby.

class GameOptionsScreen extends ConsumerStatefulWidget {
  final String nickname;
  const GameOptionsScreen({super.key, required this.nickname});

  @override
  ConsumerState<GameOptionsScreen> createState() => _GameOptionsScreenState();
}

class _GameOptionsScreenState extends ConsumerState<GameOptionsScreen> {
  int _maxPlayers = 4; // valeur initiale

  @override
  Widget build(BuildContext context) {
    final gm = ref.watch(gameProvider);
    final ctl = ref.read(gameProvider.notifier);

    if (gm.gameId != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        final nav = Navigator.of(context);
        if (nav.canPop()) nav.pop();
      });
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Options de partie')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('Nombre de joueurs'),
          const SizedBox(height: 8),
          DropdownButtonFormField<int>(
            value: _maxPlayers,
            onChanged: (v) => setState(() => _maxPlayers = v ?? 4),
            items: [
              3,
              4,
              5,
              6,
              8,
              9,
              10,
              11,
              12,
              13,
              14,
              15,
              16,
              17,
              18,
              19,
              20,
            ]
                .map((n) =>
                    DropdownMenuItem<int>(value: n, child: Text('$n joueurs')))
                .toList(),
          ),
          const SizedBox(height: 16),
          ElevatedButton(
            onPressed: (gm.socketConnected && gm.gameId == null)
                ? () async {
                    final err =
                        await ctl.createGame(widget.nickname, _maxPlayers);
                    if (err != null && context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        badgeAwareSnackBar(
                          context,
                          content: Text(err),
                          backgroundColor: Colors.red,
                        ),
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
