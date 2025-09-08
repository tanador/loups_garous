import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../state/game_provider.dart';

/// Petit badge affichant en permanence le pseudo du joueur local
/// lorsqu'une partie est rejointe. Injecté globalement via MaterialApp.builder.
class PlayerBadge extends ConsumerWidget {
  const PlayerBadge({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(gameProvider);
    final String? nick = s.playerId; // playerId == nickname côté client

    if (s.gameId == null || nick == null || nick.isEmpty) {
      // Rien à afficher tant qu'aucune partie n'est ouverte
      return const SizedBox.shrink();
    }

    final theme = Theme.of(context);
    final textStyle = theme.textTheme.bodyMedium;
    final bg = theme.colorScheme.surface.withOpacity(0.9);
    final fg = theme.colorScheme.onSurface;
    final border = theme.colorScheme.outline.withOpacity(0.3);

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(8.0),
        child: Align(
          alignment: Alignment.bottomLeft,
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: bg,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: border),
              boxShadow: const [
                BoxShadow(blurRadius: 6, offset: Offset(0, 2), color: Colors.black26),
              ],
            ),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.person, size: 16, color: fg),
                  const SizedBox(width: 6),
                  Text('Vous: $nick', style: textStyle?.copyWith(color: fg)),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

