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
              ...r.deaths.map((d) {
                String name = d.$1;
                final match = s.players.where((p) => p.id == d.$1).toList();
                if (match.isNotEmpty) name = match.first.id;
                return ListTile(
                  leading: const Icon(Icons.close),
                  title: Text(name),
                  subtitle: Text('Rôle: ${d.$2}'),
                );
              })
            ],
            if (r.saved != null) ...[
              Builder(builder: (_) {
                String name = r.saved!;
                final match = s.players.where((p) => p.id == r.saved).toList();
                if (match.isNotEmpty) name = match.first.id;
                return Text('Sauvé par la potion de vie : $name');
              })
            ]
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
