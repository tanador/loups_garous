import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../state/game_provider.dart';

/// Écran affiché lorsque les amoureux sont réveillés par Cupidon.
/// Il informe le joueur de l'identité de son partenaire.
class NightLoversScreen extends ConsumerWidget {
  const NightLoversScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final partnerId = ref.watch(gameProvider).loverPartnerId;
    return Scaffold(
      appBar: AppBar(title: const Text('Amoureux')),
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('Vous tombez amoureux...'),
            const SizedBox(height: 12),
            if (partnerId != null)
              Text('Votre partenaire est $partnerId ❤️',
                  style: const TextStyle(fontSize: 20)),
            const SizedBox(height: 24),
            const Text('Fermez les yeux'),
          ],
        ),
      ),
    );
  }
}
