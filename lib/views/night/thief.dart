import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../state/game_provider.dart';
import '../../state/models.dart';
import '../widgets/common.dart';

/// Écran du Voleur pendant la phase de nuit.
///
/// Le voleur voit les deux rôles du centre et peut décider de
/// conserver son rôle ou d'échanger avec l'une des cartes.
class ThiefView extends ConsumerStatefulWidget {
  const ThiefView({super.key});

  @override
  ConsumerState<ThiefView> createState() => _ThiefViewState();
}

class _ThiefViewState extends ConsumerState<ThiefView> {
  bool _sent = false;

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(gameProvider);
    final ctl = ref.read(gameProvider.notifier);
    final center = s.thiefCenter;
    final keepDisabled = center.length == 2 &&
        center.every((r) => r == Role.WOLF);

    return Scaffold(
      appBar: AppBar(title: const Text('Nuit — Voleur')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            DeadlineChip(deadlineMs: s.deadlineMs),
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: const [
                _FaceDownCard(),
                _FaceDownCard(),
              ],
            ),
            const SizedBox(height: 24),
            ElevatedButton(
              onPressed: !_sent && !keepDisabled
                  ? () async {
                      await ctl.thiefChoose('keep');
                      if (mounted) setState(() => _sent = true);
                    }
                  : null,
              child: const Text('Garder mon rôle'),
            ),
            const SizedBox(height: 8),
            ElevatedButton(
              onPressed: !_sent
                  ? () async {
                      await ctl.thiefChoose('swapIndex0');
                      if (mounted) setState(() => _sent = true);
                    }
                  : null,
              child: const Text('Échanger avec la carte 1'),
            ),
            const SizedBox(height: 8),
            ElevatedButton(
              onPressed: !_sent
                  ? () async {
                      await ctl.thiefChoose('swapIndex1');
                      if (mounted) setState(() => _sent = true);
                    }
                  : null,
              child: const Text('Échanger avec la carte 2'),
            ),
          ],
        ),
      ),
    );
  }
}

/// Représentation simple d'une carte face cachée.
class _FaceDownCard extends StatelessWidget {
  const _FaceDownCard();

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 2,
      child: SizedBox(
        width: 80,
        height: 120,
        child: Center(
          child: Icon(Icons.question_mark, size: 48, color: Colors.grey.shade600),
        ),
      ),
    );
  }
}
