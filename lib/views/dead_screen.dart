import 'dart:developer';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../state/game_provider.dart';

// Écran affiché aux joueurs éliminés.

class DeadScreen extends ConsumerWidget {
  const DeadScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ctl = ref.read(gameProvider.notifier);
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
