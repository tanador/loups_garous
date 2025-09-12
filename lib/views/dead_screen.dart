import 'dart:developer';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../state/game_provider.dart';
import '../state/models.dart';

// Écran affiché aux joueurs éliminés.

class DeadScreen extends ConsumerWidget {
  const DeadScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
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
    // temporairement le bouton « Quitter » quand la phase est MORNING.
    final bool blockQuit = (s.role == Role.HUNTER && s.phase == GamePhase.MORNING) || isEliminatedThisVote;
    return Scaffold(
      appBar: AppBar(title: const Text('Vous êtes mort')),
      body: Center(
        child: TweenAnimationBuilder<double>(
          tween: Tween(begin: 0, end: 1),
          duration: const Duration(seconds: 2),
          builder: (context, value, child) {
            return Opacity(
              opacity: value,
              child: Transform.scale(
                scale: value,
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Text('💀', style: TextStyle(fontSize: 80)),
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
                              Navigator.of(context)
                                  .popUntil((route) => route.isFirst);
                            }
                          }
                        },
                        child: const Text('Quitter'),
                      )
                    else
                      const Text(
                        'Attendez votre tir de chasseur...',
                        style: TextStyle(fontSize: 16),
                      )
                  ],
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}
