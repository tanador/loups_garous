import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../state/game_provider.dart';
import 'widgets/common.dart';

// Écran où le chasseur peut tirer sur un autre joueur après sa mort.

class HunterScreen extends ConsumerStatefulWidget {
  const HunterScreen({super.key});
  @override
  ConsumerState<HunterScreen> createState() => _HunterScreenState();
}

class _HunterScreenState extends ConsumerState<HunterScreen> {
  String? targetId;

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(gameProvider);
    final ctl = ref.read(gameProvider.notifier);
    final targets = s.hunterTargets;

    return Scaffold(
      appBar: AppBar(title: const Text('Dernier tir')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: targets.isEmpty
            ? const Center(child: Text('En attente...'))
            : Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  DeadlineChip(deadlineMs: s.deadlineMs),
                  const SizedBox(height: 12),
                  const Text('Qui souhaitez-vous tuer ?'),
                  Expanded(
                    child: ListView(
                      children: [
                        RadioGroup<String?>(
                          groupValue: targetId,
                          onChanged: (v) => setState(() => targetId = v),
                          child: Column(
                            children: [
                              ...targets.map((p) => RadioListTile<String?>(
                                    title: Text(p.id),
                                    value: p.id,
                                  )),
                            ],
                          ),
                        ),
                        const SizedBox(height: 12),
                        ElevatedButton(
                          onPressed: targetId == null
                              ? null
                              : () => ctl.hunterShoot(targetId!),
                          child: const Text('Tirer'),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
      ),
    );
  }
}
