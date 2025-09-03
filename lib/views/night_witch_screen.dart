import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../state/game_provider.dart';
import '../state/models.dart';
import 'widgets/common.dart';

class NightWitchScreen extends ConsumerStatefulWidget {
  const NightWitchScreen({super.key});
  @override
  ConsumerState<NightWitchScreen> createState() => _NightWitchScreenState();
}

class _NightWitchScreenState extends ConsumerState<NightWitchScreen> {
  bool save = false;
  String? poisonId;

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(gameProvider);
    final ctl = ref.read(gameProvider.notifier);
    final ww = s.witchWake;

    return Scaffold(
      appBar: AppBar(title: const Text('Nuit — Sorcière')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: ww == null
            ? const Center(child: Text('En attente...'))
            : Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  DeadlineChip(deadlineMs: s.deadlineMs),
                  const SizedBox(height: 12),
                  Builder(
                    builder: (_) {
                      String attackedName = 'Personne';
                      if (ww.attacked != null) {
                        final match = ww.alive
                            .where((p) => p.id == ww.attacked)
                            .toList();
                        attackedName = match.isEmpty
                            ? ww.attacked!
                            : match.first.id;
                      }
                      return Text('Attaqué par les loups: $attackedName');
                    },
                  ),
                  const SizedBox(height: 12),
                  CheckboxListTile(
                    value: save,
                    onChanged: ww.healAvailable && ww.attacked != null
                        ? (v) => setState(() => save = v ?? false)
                        : null,
                    title: const Text(
                      'Utiliser potion de vie (sauver la cible)',
                    ),
                  ),
                  const Divider(),
                  const Text('Potion de mort (optionnelle)'),
                  Expanded(
                    child: ListView(
                      children: [
                        ...ww.alive
                            .where((p) => p.id != s.playerId)
                            .map(
                              (p) => RadioListTile<String>(
                                title: Text(p.id),
                                value: p.id,
                                groupValue: poisonId,
                                onChanged: ww.poisonAvailable
                                    ? (v) => setState(() => poisonId = v)
                                    : null,
                              ),
                            ),
                        const SizedBox(height: 12),
                        ElevatedButton(
                          onPressed: () => ctl.witchDecision(
                            save: save,
                            poisonTargetId: poisonId,
                          ),
                          child: const Text('Confirmer mes décisions'),
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
