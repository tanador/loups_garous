import 'dart:developer';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../state/game_provider.dart';
import '../state/models.dart';
import 'death_skull_animation.dart';

// Écran affiché aux joueurs éliminés.

class DeadScreen extends ConsumerStatefulWidget {
  const DeadScreen({super.key});
  @override
  ConsumerState<DeadScreen> createState() => _DeadScreenState();
}

class _DeadScreenState extends ConsumerState<DeadScreen> {
  bool _animPlayed = false;

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(gameProvider);
    final ctl = ref.read(gameProvider.notifier);
    final me = s.players.firstWhere(
      (p) => p.id == s.playerId,
      orElse: () => const PlayerView(id: '', connected: true, alive: false),
    );
    final isEliminatedThisVote = s.phase == GamePhase.RESOLVE && s.lastVote?.eliminatedId == me.id;
    // Spécificité du rôle « Chasseur »:
    // Lorsqu’il meurt, il peut tirer une dernière balle. Cet « éveil » arrive
    // pendant la phase MORNING via l’événement serveur hunter:wake.
    // Pour éviter que le joueur quitte avant d’exercer ce pouvoir, on masque
    // temporairement le bouton « Quitter » tant qu'une cible est proposée
    // (hunterTargets non vide).
    final bool hasPendingHunterShot = s.hunterTargets.isNotEmpty;
    // Bloque le bouton Quitter tant qu'un tir de chasseur est attendu ou que
    // l'on doit encore accuser réception d'une élimination de jour.
    final bool blockQuit = hasPendingHunterShot || isEliminatedThisVote;
    // Détermine si on doit jouer l'animation maintenant (une seule fois)
    final playNow = s.showDeathAnim && !_animPlayed;
    if (playNow) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        setState(() => _animPlayed = true);
        // Déclenche l'animation plein écran (non bloquante)
        // et marque le trigger comme consommé pour éviter les replays.
        // Ne pas await pour éviter d'utiliser le contexte après un gap async.
        showDeathSkullOverlay(context);
        ctl.markDeathAnimShown();
      });
    }

    // Tête de mort animée qui "avance" lorsqu'on vient de mourir.
    Widget skull = const Text('💀', style: TextStyle(fontSize: 80));
    if (playNow) {
      skull = TweenAnimationBuilder<double>(
        tween: Tween(begin: 0.0, end: 1.0),
        duration: const Duration(milliseconds: 2200),
        curve: Curves.easeOutCubic,
        builder: (context, t, child) {
          final w = MediaQuery.of(context).size.width;
          final dx = (-0.35 * w) * (1.0 - t); // part de la gauche vers le centre
          final scale = 0.85 + 0.15 * t;
          return Opacity(
            opacity: t,
            child: Transform.translate(
              offset: Offset(dx, 0),
              child: Transform.scale(scale: scale, child: child),
            ),
          );
        },
        child: skull,
      );
    }

    Widget content = Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        skull,
        const SizedBox(height: 16),
        const Text('Vous êtes mort',
            style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
        const SizedBox(height: 24),
        if (isEliminatedThisVote)
          ElevatedButton(
            onPressed: () async {
              try {
                await ctl.voteAck();
              } catch (e, st) {
                log('voteAck exception: $e', stackTrace: st);
              }
            },
            child: const Text("J'ai vu"),
          )
        else if (!blockQuit)
          ElevatedButton(
            onPressed: () async {
              try {
                await ctl.leaveToHome();
              } catch (e, st) {
                log('leaveToHome exception: $e', stackTrace: st);
              } finally {
                if (context.mounted) {
                  Navigator.of(context).popUntil((route) => route.isFirst);
                }
              }
            },
            child: const Text('Quitter'),
          )
        else if (hasPendingHunterShot)
          const Text(
            'Attendez votre tir de chasseur...',
            style: TextStyle(fontSize: 16),
          )
        else
          const SizedBox.shrink(),
      ],
    );

    return Scaffold(
      appBar: AppBar(title: const Text('Vous êtes mort')),
      body: Center(child: content),
    );
  }
}
