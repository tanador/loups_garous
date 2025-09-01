import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../state/game_provider.dart';
import '../state/models.dart';

class RoleScreen extends ConsumerWidget {
  const RoleScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(gameProvider);
    final ctl = ref.read(gameProvider.notifier);
    final roleLabel = switch (s.role) {
      Role.WOLF => 'Loup-garou',
      Role.WITCH => 'Sorcière',
      Role.VILLAGER => 'Villageois',
      null => 'Inconnu'
    };
    return Scaffold(
      appBar: AppBar(title: const Text('Votre rôle')),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text('Vous êtes :', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 8),
            Text(roleLabel, style: const TextStyle(fontSize: 28, fontWeight: FontWeight.bold)),
            const SizedBox(height: 24),
            ElevatedButton(
              onPressed: () => ctl.sendReady(),
              child: const Text('Je suis prêt'),
            ),
          ],
        ),
      ),
    );
  }
}
