import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../state/game_provider.dart';
import '../state/models.dart';
import '../utils/snackbars.dart';
import 'widgets/common.dart';

// Ecran de la phase nocturne ou les loups designent une cible commune.

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
    // Regle metier (revote + cible interdite):
    // - Tant que le consensus n'est pas atteint entre plusieurs loups, chacun
    //   peut modifier son choix (revoter). L'UI permet donc de deverrouiller
    //   apres une validation pour changer la selection, puis revalider.
    // - Un loup ne peut pas cibler son/sa partenaire amoureuxse: on filtre
    //   localement cette cible pour eviter un rejet serveur.
    String? forbidId;
    if (s.role == Role.WOLF) {
      forbidId = s.loverPartnerId;
      if (forbidId == null && s.playerId != null && s.loversKnown.isNotEmpty) {
        final others = s.loversKnown.where((id) => id != s.playerId).toList();
        if (others.length == 1) forbidId = others.first;
      }
    }
    final shownTargets =
        s.wolvesTargets.where((t) => t.id != forbidId).toList();
    // Ne permet la validation que si la selection n'est pas interdite.
    final canValidate = selectedId != null && selectedId != forbidId;
    final theme = Theme.of(context);

    String? lockedTargetLabel;
    if (s.wolvesLockedTargetId != null) {
      lockedTargetLabel = s.wolvesLockedTargetId!;
      final match =
          shownTargets.where((t) => t.id == s.wolvesLockedTargetId).toList();
      if (match.isNotEmpty) lockedTargetLabel = match.first.id;
    }

    Future<void> submitChoice() async {
      if (selectedId == null) return;
      final messenger = ScaffoldMessenger.of(context);
      final err = await ctl.wolvesChoose(selectedId!);
      if (err == null) {
        if (mounted) setState(() => _locked = true);
      } else {
        messenger.showSnackBar(
          badgeAwareSnackBar(
            context,
            content: Text(err),
          ),
        );
      }
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Nuit - Loups')),
      body: SafeArea(
        minimum: const EdgeInsets.only(bottom: kBadgeSafeGap + 16),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text(
                'Choisissez une cible (consensus requis s\'il y a plusieurs loups).'),
            const SizedBox(height: 8),
            DeadlineChip(deadlineMs: s.deadlineMs),
            const SizedBox(height: 8),
            Expanded(
              child: RadioGroup<String?>(
                groupValue: selectedId,
                onChanged: (v) {
                  if (!_locked) setState(() => selectedId = v);
                },
                child: ListView(
                  children: shownTargets
                      .map((t) => RadioListTile<String?>(
                            title: Text(t.id),
                            value: t.id,
                            enabled: !_locked,
                          ))
                      .toList(),
                ),
              ),
            ),
            const SizedBox(height: 12),
            Card(
              margin: EdgeInsets.zero,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(16),
              ),
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _locked ? 'Vote verrouille' : 'Validation du vote',
                      style: theme.textTheme.titleMedium,
                    ),
                    const SizedBox(height: 6),
                    Text(
                      _locked
                          ? 'Touchez le bouton pour rouvrir le vote si vous changez d\'avis.'
                          : 'Selectionnez une cible puis validez pour proposer votre victime.',
                      style: theme.textTheme.bodyMedium,
                    ),
                    const SizedBox(height: 12),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton.icon(
                        onPressed: _locked
                            ? () {
                                if (mounted) setState(() => _locked = false);
                              }
                            : (!canValidate ? null : submitChoice),
                        icon: Icon(_locked ? Icons.edit : Icons.check),
                        label: Text(
                            _locked ? 'Modifier le choix' : 'Valider la cible'),
                        style: FilledButton.styleFrom(
                          minimumSize: const Size.fromHeight(48),
                          backgroundColor:
                              _locked ? theme.colorScheme.secondary : null,
                        ),
                      ),
                    ),
                    if (!_locked && selectedId != null) ...[
                      const SizedBox(height: 12),
                      Row(
                        children: [
                          const Icon(Icons.adjust, size: 18),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text('Cible selectionnee : $selectedId'),
                          ),
                        ],
                      ),
                    ],
                    if (lockedTargetLabel != null) ...[
                      const SizedBox(height: 12),
                      Row(
                        children: [
                          const Icon(Icons.lock, size: 18),
                          const SizedBox(width: 8),
                          Expanded(
                            child:
                                Text('Cible verrouillee : $lockedTargetLabel'),
                          ),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'Confirmations restantes : ${s.confirmationsRemaining}',
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
            if (s.wolvesLastTally != null) ...[
              const SizedBox(height: 12),
              Card(
                margin: EdgeInsets.zero,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Egalite detectee',
                        style: theme.textTheme.titleMedium,
                      ),
                      const SizedBox(height: 6),
                      const Text('Revotez pour departager la cible.'),
                      const SizedBox(height: 8),
                      Builder(builder: (_) {
                        final entries = s.wolvesLastTally!.entries.map((e) {
                          String name = e.key;
                          final match =
                              s.players.where((p) => p.id == e.key).toList();
                          if (match.isNotEmpty) name = match.first.id;
                          return '$name: ${e.value}';
                        }).join(', ');
                        return Text('Comptage : $entries');
                      }),
                    ],
                  ),
                ),
              ),
            ],
          ]),
        ),
      ),
    );
  }
}
