import 'dart:developer';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../state/game_provider.dart';
import '../state/models.dart';

// Écran affiché à la fin de la partie avec le récapitulatif des rôles.

class EndScreen extends ConsumerWidget {
  const EndScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(gameProvider);
    final ctl = ref.read(gameProvider.notifier);
    final win = s.winner ?? 'Inconnu';
    final text = switch (win) {
      'WOLVES' => 'Victoire des Loups',
      'VILLAGE' => 'Victoire du Village',
      'LOVERS' => 'Victoire du Couple',
      _ => 'Partie terminée',
    };
    String roleLabel(Role r) => switch (r) {
          Role.WOLF => 'Loup-garou',
          Role.WITCH => 'Sorcière',
          Role.HUNTER => 'Chasseur',
          Role.VILLAGER => 'Villageois',
          Role.CUPID => 'Cupidon',
        };
    final roles = s.finalRoles;
    // Détermine qui était amoureux pour l'affichage final.
    // 1) Utilise les infos locales connues (si tu étais amoureux).
    // 2) Si les amoureux ont gagné et que 2 survivants existent, marque-les.
    final lovers = {...s.loversKnown};
    if (s.winner == 'LOVERS') {
      final aliveNow = s.players.where((p) => p.alive).map((p) => p.id).toList(growable: false);
      if (aliveNow.length == 2) {
        lovers.addAll(aliveNow);
      }
    }
    return Scaffold(
      appBar: AppBar(title: const Text('Fin de partie')),
      body: Center(
        child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
          Text(text,
              style:
                  const TextStyle(fontSize: 26, fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          for (final (playerId, role) in roles)
            Text(
              lovers.contains(playerId)
                  ? '$playerId (amoureux) : ${roleLabel(role)}'
                  : '$playerId : ${roleLabel(role)}',
            ),
          const SizedBox(height: 16),
          ElevatedButton(
              onPressed: () async {
                try {
                  await ctl.leaveToHome();
                } catch (e, st) {
                  log('leaveToHome exception: $e', stackTrace: st);
                } finally {
                  if (context.mounted) {
                    Navigator.of(context)
                        .popUntil((route) => route.isFirst);
                  }
                }
              },
              child: const Text('Retour à l’accueil'))
        ]),
      ),
    );
  }
}
