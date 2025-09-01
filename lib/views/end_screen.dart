import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../state/game_provider.dart';

class EndScreen extends ConsumerWidget {
  const EndScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(gameProvider);
    final ctl = ref.read(gameProvider.notifier);
    final win = s.winner ?? 'Inconnu';
    final text = win == 'WOLVES' ? 'Victoire des Loups' : (win == 'VILLAGE' ? 'Victoire du Village' : 'Partie terminée');
    return Scaffold(
      appBar: AppBar(title: const Text('Fin de partie')),
      body: Center(
        child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
          Text(text, style: const TextStyle(fontSize: 26, fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          ElevatedButton(onPressed: () => ctl.leaveToHome(), child: const Text('Retour à l’accueil'))
        ]),
      ),
    );
  }
}
