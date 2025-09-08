import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../state/game_provider.dart';
import '../../state/models.dart';

/// Petit badge affichant en permanence le pseudo du joueur local
/// lorsqu'une partie est rejointe. Injecté globalement via MaterialApp.builder.
class PlayerBadge extends ConsumerStatefulWidget {
  const PlayerBadge({super.key});

  @override
  ConsumerState<PlayerBadge> createState() => _PlayerBadgeState();
}

class _PlayerBadgeState extends ConsumerState<PlayerBadge> {
  bool _pressed = false;
  bool _revealed = false;
  Timer? _timer;

  String _roleLabel(Role r) => switch (r) {
        Role.WOLF => 'Loup-garou',
        Role.WITCH => 'Sorcière',
        Role.HUNTER => 'Chasseur',
        Role.VILLAGER => 'Villageois',
        Role.CUPID => 'Cupidon',
      };

  @override
  Widget build(BuildContext context) {
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

    final showRole = _revealed && s.role != null;
    final label = showRole ? 'Rôle: ${_roleLabel(s.role!)}' : 'Vous: $nick';
    final icon = showRole ? Icons.visibility : Icons.person;

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(8.0),
        child: Align(
          alignment: Alignment.bottomLeft,
          child: GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTapDown: (_) {
              setState(() {
                _pressed = true;
                _revealed = false;
              });
              _timer?.cancel();
              final ms = s.rolePressRevealMs;
              _timer = Timer(Duration(milliseconds: ms), () {
                if (mounted && _pressed) setState(() => _revealed = true);
              });
            },
            onTapUp: (_) {
              _timer?.cancel();
              setState(() {
                _pressed = false;
                _revealed = false;
              });
            },
            onTapCancel: () {
              _timer?.cancel();
              setState(() {
                _pressed = false;
                _revealed = false;
              });
            },
            child: ExcludeSemantics(
              excluding: true,
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
                      Icon(icon, size: 16, color: fg),
                      const SizedBox(width: 6),
                      Text(label, style: textStyle?.copyWith(color: fg)),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
