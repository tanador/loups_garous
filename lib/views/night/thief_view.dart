import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../state/game_provider.dart';
import '../../state/models.dart';
import '../widgets/common.dart';
import 'package:flutter/services.dart';

/// Écran privé du Voleur (Nuit 0).
/// Affiche les 2 cartes du centre et propose:
/// - "Garder" (désactivé si 2 loups au centre),
/// - "Prendre A" / "Prendre B" pour échanger sa carte.
class ThiefView extends ConsumerWidget {
  const ThiefView({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(gameProvider);
    final ctl = ref.read(gameProvider.notifier);
    final center = s.thiefCenter;
    final mustTakeWolf = center.length == 2 && center[0] == Role.WOLF && center[1] == Role.WOLF;
    final messenger = ScaffoldMessenger.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Nuit — Voleur')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            DeadlineChip(deadlineMs: s.deadlineMs),
            const SizedBox(height: 12),
            Text(
              mustTakeWolf
                  ? 'Deux Loups au centre: choisissez l’une des deux cartes.'
                  : 'Choisissez une des trois options:',
            ),
            const SizedBox(height: 12),
            // Choix A et B (sur une ligne)
            Row(
              children: [
                Expanded(
                  child: _ChoiceTile(
                    title: 'Prendre :',
                    subtitle: _roleLabel(center.isNotEmpty ? center[0] : null),
                    icon: _roleIcon(center.isNotEmpty ? center[0] : null),
                    color: _roleColor(context, center.isNotEmpty ? center[0] : null),
                    enabled: center.isNotEmpty,
                    onTap: center.isNotEmpty
                        ? () async {
                            final err = await ctl.thiefSwap(0);
                            if (err != null) {
                              messenger.showSnackBar(SnackBar(content: Text(err)));
                            } else {
                              if (s.vibrations) await HapticFeedback.selectionClick();
                              // Pas de notification de prise pour préserver la confidentialité
                            }
                          }
                        : null,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: _ChoiceTile(
                    title: 'Prendre :',
                    subtitle: _roleLabel(center.length > 1 ? center[1] : null),
                    icon: _roleIcon(center.length > 1 ? center[1] : null),
                    color: _roleColor(context, center.length > 1 ? center[1] : null),
                    enabled: center.length > 1,
                    onTap: center.length > 1
                        ? () async {
                            final err = await ctl.thiefSwap(1);
                            if (err != null) {
                              messenger.showSnackBar(SnackBar(content: Text(err)));
                            } else {
                              if (s.vibrations) await HapticFeedback.selectionClick();
                              // Pas de notification de prise pour préserver la confidentialité
                            }
                          }
                        : null,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            // Garder le voleur (sur une ligne en dessous)
            _ChoiceTile(
              title: 'Garder le voleur',
              subtitle: _roleLabel(Role.THIEF),
              icon: _roleIcon(Role.THIEF),
              color: _roleColor(context, Role.THIEF),
              enabled: !mustTakeWolf,
              onTap: !mustTakeWolf
                  ? () async {
                      final err = await ctl.thiefKeep();
                      if (err != null) {
                        messenger.showSnackBar(SnackBar(content: Text(err)));
                      } else {
                        if (s.vibrations) await HapticFeedback.selectionClick();
                        messenger.showSnackBar(
                          const SnackBar(content: Text('Vous gardez votre carte.')),
                        );
                      }
                    }
                  : null,
            ),
          ],
        ),
      ),
    );
  }
}

String _roleLabel(Role? r) {
  if (r == null) return '???';
  switch (r) {
    case Role.WOLF:
      return 'Loup-garou';
    case Role.WITCH:
      return 'Sorcière';
    case Role.HUNTER:
      return 'Chasseur';
    case Role.SEER:
      return 'Voyante';
    case Role.PETITE_FILLE:
      return 'Petite fille';
    case Role.THIEF:
      return 'Voleur';
    case Role.VILLAGER:
      return 'Villageois';
    case Role.CUPID:
      return 'Cupidon';
  }
}

IconData _roleIcon(Role? r) {
  switch (r) {
    case Role.WOLF:
      return Icons.pets;
    case Role.WITCH:
      return Icons.auto_awesome;
    case Role.HUNTER:
      return Icons.gps_fixed;
    case Role.SEER:
      return Icons.visibility;
    case Role.PETITE_FILLE:
      return Icons.child_care;
    case Role.THIEF:
      return Icons.change_circle;
    case Role.VILLAGER:
      return Icons.person;
    case Role.CUPID:
      return Icons.favorite;
    default:
      return Icons.help_outline;
  }
}

Color _roleColor(BuildContext context, Role? r) {
  final cs = Theme.of(context).colorScheme;
  switch (r) {
    case Role.WOLF:
      return Colors.redAccent;
    case Role.WITCH:
      return Colors.purpleAccent;
    case Role.HUNTER:
      return Colors.brown;
    case Role.SEER:
      return Colors.indigo;
    case Role.PETITE_FILLE:
      return Colors.orangeAccent;
    case Role.THIEF:
      return Colors.teal;
    case Role.VILLAGER:
      return cs.primary;
    case Role.CUPID:
      return Colors.pinkAccent;
    default:
      return cs.outline;
  }
}

class _ChoiceTile extends StatelessWidget {
  final String title;
  final String subtitle;
  final IconData icon;
  final Color color;
  final bool enabled;
  final VoidCallback? onTap;
  const _ChoiceTile({
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.color,
    this.enabled = true,
    this.onTap,
  });
  @override
  Widget build(BuildContext context) {
    final outline = Theme.of(context).colorScheme.outline;
    final card = Container(
      height: 120,
      decoration: BoxDecoration(
        border: Border.all(color: enabled ? outline : outline.withValues(alpha: 0.4)),
        borderRadius: BorderRadius.circular(10),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, color: enabled ? color : color.withValues(alpha: 0.4), size: 28),
          const SizedBox(height: 8),
          Text(title, style: TextStyle(fontWeight: FontWeight.bold, color: enabled ? null : Colors.grey)),
          const SizedBox(height: 4),
          Text(subtitle, style: TextStyle(color: enabled ? null : Colors.grey)),
        ],
      ),
    );
    if (!enabled || onTap == null) return card;
    return InkWell(onTap: onTap, child: card);
  }
}
