import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../state/game_provider.dart';
import '../state/models.dart';

// Écran révélant au joueur son rôle tiré au sort.

class RoleScreen extends ConsumerStatefulWidget {
  const RoleScreen({super.key});

  @override
  ConsumerState<RoleScreen> createState() => _RoleScreenState();
}

class _RoleScreenState extends ConsumerState<RoleScreen> {
  bool _isReady = false;

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(gameProvider);
    final ctl = ref.read(gameProvider.notifier);
    final roleLabel = switch (s.role) {
      Role.WOLF => 'Loup-garou',
      Role.WITCH => 'Sorcière',
      Role.HUNTER => 'Chasseur',
      Role.VILLAGER => 'Villageois',
      Role.CUPID => 'Cupidon',
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
            Text(roleLabel,
                style: const TextStyle(fontSize: 28, fontWeight: FontWeight.bold)),
            const SizedBox(height: 24),
            ElevatedButton(
              onPressed: () {
                final newReady = !_isReady;
                setState(() => _isReady = newReady);
                ctl.toggleReady(newReady);
              },
              style: ElevatedButton.styleFrom(
                backgroundColor: _isReady ? Colors.green : null,
              ),
              child: const Text('Je suis prêt'),
            ),
          ],
        ),
      ),
    );
  }
}
