import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../state/game_provider.dart';
import '../state/models.dart';
import 'widgets/common.dart';

class NightWolvesScreen extends ConsumerStatefulWidget {
  const NightWolvesScreen({super.key});
  @override
  ConsumerState<NightWolvesScreen> createState() => _NightWolvesScreenState();
}

class _NightWolvesScreenState extends ConsumerState<NightWolvesScreen> {
  String? selectedId;

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(gameProvider);
    final ctl = ref.read(gameProvider.notifier);

    return Scaffold(
      appBar: AppBar(title: const Text('Nuit — Loups')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(children: [
          const Text('Choisissez une cible (consensus requis en V1).'),
          const SizedBox(height: 8),
          DeadlineChip(deadlineMs: s.deadlineMs),
          const SizedBox(height: 8),
          Expanded(
            child: ListView(
              children: s.wolvesTargets
                  .map((t) => RadioListTile<String>(
                        title: Text(t.nickname),
                        value: t.id,
                        groupValue: selectedId,
                        onChanged: (v) => setState(() => selectedId = v),
                      ))
                  .toList(),
            ),
          ),
          if (s.wolvesLockedTargetId != null)
            Builder(builder: (_) {
              String locked = s.wolvesLockedTargetId!;
              final match =
                  s.wolvesTargets.where((t) => t.id == s.wolvesLockedTargetId).toList();
              if (match.isNotEmpty) locked = match.first.nickname;
              return Text(
                  'Cible verrouillée: $locked • confirmations restantes: ${s.confirmationsRemaining}');
            }),
          const SizedBox(height: 12),
          ElevatedButton(
            onPressed: selectedId == null ? null : () => ctl.wolvesChoose(selectedId!),
            child: const Text('Valider la cible'),
          ),
        ]),
      ),
    );
  }
}
