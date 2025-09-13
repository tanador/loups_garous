import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../state/game_provider.dart';
import '../state/models.dart';
import 'widgets/common.dart';
import 'death_skull_animation.dart';

// Écran du matin récapitulant les événements de la nuit.

class MorningScreen extends ConsumerStatefulWidget {
  const MorningScreen({super.key});

  @override
  ConsumerState<MorningScreen> createState() => _MorningScreenState();
}

class _MorningScreenState extends ConsumerState<MorningScreen> {
  bool _ack = false;
  bool _animPlayed = false;

  @override
  Widget build(BuildContext context) {
    ref.listen<DayRecap?>(gameProvider.select((s) => s.recap), (prev, next) {
      if (prev != next) {
        setState(() => _ack = false);
      }
    });

    final s = ref.watch(gameProvider);
    final ctl = ref.read(gameProvider.notifier);
    final r = s.recap;

    // Déclenche l'animation si le provider indique une mort récente
    final playNow = s.showDeathAnim && !_animPlayed;
    if (playNow) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        setState(() => _animPlayed = true);
        showDeathSkullOverlay(context);
        ctl.markDeathAnimShown();
      });
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Matin')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          DeadlineChip(deadlineMs: s.deadlineMs),
          const SizedBox(height: 8),
          if (r == null) const Text('Réveil du village...')
          else ...[
            if (r.deaths.isEmpty)
              const Text('Personne n’est mort cette nuit.')
            else ...[
              const Text('Morts cette nuit :'),
              const SizedBox(height: 8),
              ...r.deaths.map((d) {
                String name = d.$1;
                final match = s.players.where((p) => p.id == d.$1).toList();
                if (match.isNotEmpty) name = match.first.id;
                return ListTile(
                  leading: const Icon(Icons.close),
                  title: Text(name),
                  subtitle: Text('Rôle: ${d.$2}'),
                );
              }),
              if (r.hunterKills.isNotEmpty) ...[
                const SizedBox(height: 16),
                const Text('Le chasseur a tué :'),
                const SizedBox(height: 8),
                ...r.hunterKills.map((pid) {
                  String name = pid;
                  final match = s.players.where((p) => p.id == pid).toList();
                  if (match.isNotEmpty) name = match.first.id;
                  return ListTile(
                    leading: const Icon(Icons.bolt),
                    title: Text(name),
                  );
                })
              ]
            ],
          ],
          Expanded(
            child: Center(
              child: ElevatedButton(
                onPressed: () {
                  final newAck = !_ack;
                  setState(() => _ack = newAck);
                  if (newAck) ctl.dayAck();
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: _ack ? Colors.green : null,
                ),
                child: const Text('J’ai lu'),
              ),
            ),
          )
        ]),
      ),
    );
  }
}
