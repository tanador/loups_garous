import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../state/game_provider.dart';
import 'widgets/common.dart';

class MorningScreen extends ConsumerWidget {
  const MorningScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(gameProvider);
    final ctl = ref.read(gameProvider.notifier);
    final r = s.recap;

    return Scaffold(
      appBar: AppBar(title: const Text('Matin')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          DeadlineChip(deadlineMs: s.deadlineMs),
          const SizedBox(height: 8),
          if (r == null) const Text('Réveil du village...')
          else ...[
            if (r.deaths.isEmpty) const Text('Personne n’est mort cette nuit.')
            else ...[
              const Text('Morts cette nuit :'),
              const SizedBox(height: 8),
              ...r.deaths.map((d) => ListTile(
                    leading: const Icon(Icons.close),
                    title: Text(d.$1),
                    subtitle: Text('Rôle: ${d.$2}'),
                  ))
            ],
            if (r.saved != null) Text('Sauvé par la potion de vie : ${r.saved}')
          ],
          const Spacer(),
          ElevatedButton(
            onPressed: () => ctl.dayAck(),
            child: const Text('J’ai lu'),
          )
        ]),
      ),
    );
  }
}
