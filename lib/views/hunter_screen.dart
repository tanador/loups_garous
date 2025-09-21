import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../state/game_provider.dart';
import 'hunter_prompt.dart';

// Écran où le chasseur peut tirer sur un autre joueur après sa mort.
class HunterScreen extends ConsumerWidget {
  const HunterScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Garder l'écoute active pour rafraîchir la liste de cibles et la deadline.
    ref.watch(gameProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Dernier tir')),
      body: const Padding(
        padding: EdgeInsets.all(16),
        child: HunterPrompt(
          scrollable: true,
        ),
      ),
    );
  }
}
