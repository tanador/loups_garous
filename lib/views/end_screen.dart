import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../state/game_provider.dart';
import '../state/models.dart';
import '../utils/app_logger.dart';
import 'connect_screen.dart';

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
          Role.SEER => 'Voyante',
          Role.PETITE_FILLE => 'Petite fille',
          Role.THIEF => 'Voleur',
          Role.VILLAGER => 'Villageois',
          Role.CUPID => 'Cupidon',
        };
    final roles = s.finalRoles;
    // Détermine qui était amoureux pour l'affichage final.
    // 1) Utilise les infos locales connues (si tu étais amoureux).
    // 2) Si les amoureux ont gagné et que 2 survivants existent, marque-les.
    final lovers = {...s.loversKnown};
    if (s.winner == 'LOVERS') {
      final aliveNow = s.players
          .where((p) => p.alive)
          .map((p) => p.id)
          .toList(growable: false);
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
          // Pour chaque joueur, on affiche une icône d'état en plus du rôle:
          // - coche verte = vivant
          // - tête de mort = mort
          // Cela permet à quelqu'un ne connaissant pas le déroulé d'identifier
          // visuellement qui a survécu sans devoir interpréter d'autres écrans.
          for (final (playerId, role) in roles)
            Builder(builder: (context) {
              final alive = s.players
                  .firstWhere(
                    (p) => p.id == playerId,
                    orElse: () =>
                        const PlayerView(id: '', connected: true, alive: false),
                  )
                  .alive;
              final text = lovers.contains(playerId)
                  ? '$playerId (amoureux) : ${roleLabel(role)}'
                  : '$playerId : ${roleLabel(role)}';
              return ListTile(
                dense: true,
                leading: alive
                    ? const Icon(Icons.check_circle, color: Colors.green)
                    : const Text('☠️', style: TextStyle(fontSize: 20)),
                title: Text(text),
              );
            }),
          const SizedBox(height: 16),
          ElevatedButton(
              onPressed: () async {
                // Capture le Navigator avant l'attente pour éviter d'utiliser
                // un BuildContext après un gap async.
                final nav = Navigator.of(context);
                try {
                  await ctl.leaveToHome();
                } catch (e, st) {
                  AppLogger.log('leaveToHome exception: $e', stackTrace: st);
                } finally {
                  // Garantit un retour fiable à l'accueil, même si des routes
                  // intermédiaires (ex. options de partie) sont encore empilées.
                  nav.pushAndRemoveUntil(
                    MaterialPageRoute(builder: (_) => const ConnectScreen()),
                    (route) => false,
                  );
                }
              },
              child: const Text('Retour à l\'accueil'))
        ]),
      ),
    );
  }
}
