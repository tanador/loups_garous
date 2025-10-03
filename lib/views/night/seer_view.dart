import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../state/game_provider.dart';
import '../../utils/snackbars.dart';
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
    final pending = s.seerPending;

    // Si une révélation est en attente d'ACK, afficher un écran bloquant
    if (pending != null) {
      final name = pending.$1;
      final roleName = pending.$2.name;
      return Scaffold(
        appBar: AppBar(title: const Text('Révélation — Voyante')),
        body: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Icon(Icons.visibility, size: 72),
              const SizedBox(height: 16),
              Text('Vous avez sondé :',
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              Text(name,
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.headlineSmall),
              const SizedBox(height: 12),
              Text('Son rôle est :',
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              Text(roleName,
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.headlineSmall),
              const SizedBox(height: 24),
              ElevatedButton(
                onPressed: () async {
                  await ctl.seerAck();
                },
                child: const Text("J'ai lu"),
              ),
            ],
          ),
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Nuit — Voyante')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          DeadlineChip(deadlineMs: s.deadlineMs),
          const SizedBox(height: 12),
          if (targets.isEmpty) ...[
            const Center(child: Text('En attente...')),
          ] else ...[
            RadioGroup<String?>(
              groupValue: _selected,
              onChanged: (v) {
                if (_sent) return;
                setState(() => _selected = v);
              },
              child: Column(
                children: [
                  ...targets.where((t) => t.id != s.playerId).map(
                        (t) => RadioListTile<String?>(
                          title: Text(t.id),
                          value: t.id,
                        ),
                      ),
                ],
              ),
            ),
            const SizedBox(height: 8),
            ElevatedButton(
              onPressed: !_sent && _selected != null
                  ? () async {
                      try {
                        await ctl.seerPeek(_selected!);
                        if (!mounted || !context.mounted) return;
                        setState(() => _sent = true);
                      } catch (e) {
                        if (!context.mounted) return;
                        ScaffoldMessenger.of(context).showSnackBar(
                          badgeAwareSnackBar(
                            context,
                            content: Text('Erreur: $e'),
                          ),
                        );
                      }
                    }
                  : null,
              child: const Text('Révéler'),
            ),
          ],
          const SizedBox(height: 12),
          if (s.seerLog.isNotEmpty) ...[
            const Text('Révélations:'),
            const SizedBox(height: 4),
            ...s.seerLog.map(
              (e) {
                final name = e.$1;
                final roleName = e.$2.name;
                return Text('$name est $roleName');
              },
            ),
          ],
        ],
      ),
    );
  }
}
