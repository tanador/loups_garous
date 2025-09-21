import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../state/game_provider.dart';
import 'hunter_prompt.dart';

// Écran où le chasseur peut tirer sur un autre joueur après sa mort.
class HunterScreen extends ConsumerWidget {
  const HunterScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Keep watching the provider so the screen reacts to updates (deadline, options).
    ref.watch(gameProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Dernier tir')),
      body: const HunterPrompt(
        padding: EdgeInsets.all(16),
        scrollable: true,
      ),
    );
  }
}
