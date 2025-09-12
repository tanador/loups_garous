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
    // Règle métier (revote + cible interdite):
    // - Tant que le consensus n'est pas atteint entre plusieurs loups, chacun
    //   peut modifier son choix (revoter). L'UI permet donc de déverrouiller
    //   après une validation pour changer la sélection, puis revalider.
    // - Un loup ne peut pas cibler son/sa partenaire amoureux·se: on filtre
    //   localement cette cible pour éviter un rejet serveur.
    String? forbidId;
    if (s.role == Role.WOLF) {
      forbidId = s.loverPartnerId;
      if (forbidId == null && s.playerId != null && s.loversKnown.isNotEmpty) {
        final others = s.loversKnown.where((id) => id != s.playerId).toList();
        if (others.length == 1) forbidId = others.first;
      }
    }
    final shownTargets = s.wolvesTargets.where((t) => t.id != forbidId).toList();
    // Ne permet la validation que si la sélection n’est pas interdite.
    final canValidate = selectedId != null && selectedId != forbidId;

    return Scaffold(
      appBar: AppBar(title: const Text('Nuit - Loups')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('Choisissez une cible (consensus requis s\'il y a plusieurs loups).'),
          const SizedBox(height: 8),
          DeadlineChip(deadlineMs: s.deadlineMs),
          const SizedBox(height: 8),
          RadioGroup<String?>(
            groupValue: selectedId,
            onChanged: (v) {
              if (!_locked) setState(() => selectedId = v);
            },
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
            // Comportement du bouton:
            // - Non verrouillé: on envoie le vote au serveur; on ne verrouille
            //   l'UI qu'après ACK positif pour éviter les faux positifs.
            // - Déjà verrouillé: on propose "Modifier le choix" tant que le
            //   consensus n'est pas atteint, ce qui permet aux loups de revoter.
            onPressed: _locked
                ? () {
                    if (mounted) setState(() => _locked = false);
                  }
                : (!canValidate
                    ? null
                    : () async {
                        final messenger = ScaffoldMessenger.of(context);
                        final err = await ctl.wolvesChoose(selectedId!);
                        if (err == null) {
                          if (mounted) setState(() => _locked = true);
                        } else {
                          messenger.showSnackBar(
                            SnackBar(content: Text(err)),
                          );
                        }
                      }),
            style: ElevatedButton.styleFrom(
              backgroundColor: _locked ? Colors.green : null,
            ),
            child: Text(_locked ? 'Modifier le choix' : 'Valider la cible'),
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
          // En cas d'égalité entre loups (tous ont voté sans consensus),
          // le serveur envoie un récap wolves:results. Affichez un message
          // d'égalité et le comptage pour inviter à revoter.
          if (s.wolvesLastTally != null) ...[
            const Divider(),
            const Text('Égalité, veuillez revoter.'),
            const SizedBox(height: 8),
            Builder(builder: (_) {
              final entries = s.wolvesLastTally!.entries
                  .map((e) {
                    String name = e.key;
                    final match = s.players.where((p) => p.id == e.key).toList();
                    if (match.isNotEmpty) name = match.first.id;
                    return '$name: ${e.value}';
                  })
                  .join(', ');
              return Text('Comptage: $entries');
            }),
          ],
        ]),
      ),
    );
  }
}
