import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../state/game_provider.dart';
import '../../state/models.dart';
import '../widgets/common.dart';

/// Écran de la voyante pendant la phase de nuit.
///
/// Dans *Loup Garou*, la voyante est une villageoise qui peut
/// chaque nuit regarder secrètement le rôle d'un autre joueur.
/// Cette vue présente la liste des cibles vivantes et envoie
/// l'évènement `seer:peek` au serveur lorsque l'utilisateur confirme
/// son choix.
class SeerView extends ConsumerStatefulWidget {
  const SeerView({super.key});

  @override
  ConsumerState<SeerView> createState() => _SeerViewState();
}

class _SeerViewState extends ConsumerState<SeerView> {
  String? _selected;
  bool _sent = false;

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(gameProvider);
    final ctl = ref.read(gameProvider.notifier);
    final targets = s.seerTargets;

    return Scaffold(
      appBar: AppBar(title: const Text('Nuit — Voyante')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            DeadlineChip(deadlineMs: s.deadlineMs),
            const SizedBox(height: 12),
            Expanded(
              child: targets.isEmpty
                  ? const Center(child: Text('En attente...'))
                  : ListView(
                      children: targets
                          .where((t) => t.id != s.playerId)
                          .map(
                            (t) => RadioListTile<String?>(
                              title: Text(t.id),
                              value: t.id,
                              groupValue: _selected,
                              onChanged: _sent ? null : (v) => setState(() => _selected = v),
                            ),
                          )
                          .toList(),
                    ),
            ),
            ElevatedButton(
              onPressed: !_sent && _selected != null
                  ? () async {
                      await ctl.seerPeek(_selected!);
                      if (mounted) setState(() => _sent = true);
                    }
                  : null,
              child: const Text('Révéler'),
            ),
            const SizedBox(height: 12),
            if (s.seerLog.isNotEmpty) ...[
              const Text('Révélations:'),
              const SizedBox(height: 4),
              ...s.seerLog.map(
                (e) {
                  final name = e.$1;
                  final roleName = describeEnum(e.$2);
                  return Text('$name est $roleName');
                },
              ),
            ],
          ],
        ),
      ),
    );
  }
}

