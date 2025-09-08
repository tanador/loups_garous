import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../state/game_provider.dart';
import 'widgets/common.dart';

// Écran où Cupidon choisit deux joueurs à lier par l'amour.

class NightCupidScreen extends ConsumerStatefulWidget {
  const NightCupidScreen({super.key});
  @override
  ConsumerState<NightCupidScreen> createState() => _NightCupidScreenState();
}

class _NightCupidScreenState extends ConsumerState<NightCupidScreen> {
  final Set<String> _selected = {};

  void _toggle(String id) {
    setState(() {
      if (_selected.contains(id)) {
        _selected.remove(id);
      } else {
        if (_selected.length < 2) {
          _selected.add(id);
        }
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(gameProvider);
    final ctl = ref.read(gameProvider.notifier);
    // Autorise Cupidon à se sélectionner lui-même comme amoureux
    final targets = s.cupidTargets.toList();

    return Scaffold(
      appBar: AppBar(title: const Text('Nuit — Cupidon')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: targets.isEmpty
            ? const Center(child: Text('En attente...'))
            : Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  DeadlineChip(deadlineMs: s.deadlineMs),
                  const SizedBox(height: 12),
                  const Text('Sélectionnez deux joueurs à lier par l’amour.'),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 8,
                    children: _selected
                        .map((id) => Chip(label: Text(id)))
                        .toList(),
                  ),
                  const SizedBox(height: 8),
                  Expanded(
                    child: ListView(
                      children: [
                        ...targets.map((p) => CheckboxListTile(
                              title: Text(p.id),
                              value: _selected.contains(p.id),
                              onChanged: (v) {
                                if (v == true && _selected.length >= 2) return;
                                _toggle(p.id);
                              },
                            )),
                        const SizedBox(height: 12),
                        ElevatedButton(
                          onPressed: _selected.length == 2
                              ? () {
                                  final it = _selected.toList();
                                  ctl.cupidChoose(it[0], it[1]);
                                }
                              : null,
                          child: const Text('Valider les amoureux'),
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
