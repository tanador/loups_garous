import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../state/game_provider.dart';
import '../state/models.dart';
import 'widgets/common.dart';

// Écran de la phase nocturne où les loups désignent une cible commune.

class NightWolvesScreen extends ConsumerStatefulWidget {
  const NightWolvesScreen({super.key});
  @override
  ConsumerState<NightWolvesScreen> createState() => _NightWolvesScreenState();
}

class _NightWolvesScreenState extends ConsumerState<NightWolvesScreen> {
  String? selectedId;
  bool _locked = false;

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(gameProvider);
    final ctl = ref.read(gameProvider.notifier);
    // Filtre la cible interdite (amoureux·se) pour éviter un rejet serveur.
    String? forbidId;
    if (s.role == Role.WOLF) {
      forbidId = s.loverPartnerId;
      if (forbidId == null && s.playerId != null && s.loversKnown.isNotEmpty) {
        final others = s.loversKnown.where((id) => id != s.playerId).toList();
        if (others.length == 1) forbidId = others.first;
      }
    }
    final shownTargets = s.wolvesTargets.where((t) => t.id != forbidId).toList();
    final canValidate = selectedId != null && selectedId != forbidId;

    return Scaffold(
      appBar: AppBar(title: const Text('Nuit — Loups')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('Choisissez une cible (consensus requis s\'il y a plusieurs loups).'),
          const SizedBox(height: 8),
          DeadlineChip(deadlineMs: s.deadlineMs),
          const SizedBox(height: 8),
          RadioGroup<String?>(
            groupValue: selectedId,
            onChanged: (v) { if(!_locked) setState(() => selectedId = v); },
            child: ListView(
              shrinkWrap: true,
              children: shownTargets
                  .map((t) => RadioListTile<String?>(
                        title: Text(t.id),
                        value: t.id,
                        enabled: !_locked,
                      ))
                  .toList(),
            ),
          ),
          const SizedBox(height: 12),
          ElevatedButton(
            onPressed: !canValidate
                ? null
                : () async {
                    final err = await ctl.wolvesChoose(selectedId!);
                    if (err == null) {
                      if (mounted) setState(() => _locked = true);
                    } else if (mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(content: Text(err)),
                      );
                    }
                  },
            style: ElevatedButton.styleFrom(
              backgroundColor: _locked ? Colors.green : null,
            ),
            child: const Text('Valider la cible'),
          ),
          if (s.wolvesLockedTargetId != null)
            Builder(builder: (_) {
              String locked = s.wolvesLockedTargetId!;
              final match =
                  shownTargets.where((t) => t.id == s.wolvesLockedTargetId).toList();
              if (match.isNotEmpty) locked = match.first.id;
              return Text(
                  'Cible verrouillée: $locked • confirmations restantes: ${s.confirmationsRemaining}');
            }),
        ]),
      ),
    );
  }
}
