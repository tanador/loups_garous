import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../state/game_provider.dart';
import '../state/models.dart';

// Écran révélant au joueur son rôle tiré au sort.

class RoleScreen extends ConsumerWidget {
  const RoleScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(gameProvider);
    final ctl = ref.read(gameProvider.notifier);
    // Libellé du rôle (compatible Dart sans « switch expression »)
    final role = s.role;
    String roleLabel;
    if (role == null) {
      roleLabel = 'Inconnu';
    } else {
      switch (role) {
        case Role.WOLF:
          roleLabel = 'Loup-garou';
          break;
        case Role.WITCH:
          roleLabel = 'Sorcière';
          break;
        case Role.HUNTER:
          roleLabel = 'Chasseur';
          break;
        case Role.SEER:
          roleLabel = 'Voyante';
          break;
        case Role.PETITE_FILLE:
          roleLabel = 'Petite fille';
          break;
        case Role.THIEF:
          roleLabel = 'Voleur';
          break;
        case Role.VILLAGER:
          roleLabel = 'Villageois';
          break;
        case Role.CUPID:
          roleLabel = 'Cupidon';
          break;
      }
    }
    final meId = s.playerId;
    final players = s.players;
    final isAllReady = players.isNotEmpty && players.every((p) {
      if (p.id == meId) return s.youReadyLocal || p.ready;
      return p.ready;
    });

    final total = players.length;
    final readyCount = players.where((p) => (p.id == meId) ? (s.youReadyLocal || p.ready) : p.ready).length;

    // Prépare le panneau d'attente pour alléger l'expression dans la Column
    final Widget waitingPanel = (s.youReadyLocal && !isAllReady)
        ? _WaitingPanel(
            readyCount: readyCount,
            total: total,
            players: players,
            meId: meId,
            isReadyLocal: s.youReadyLocal,
          )
        : const SizedBox.shrink();

    return Scaffold(
      appBar: AppBar(title: const Text('Votre rôle')),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (!s.youReadyLocal) ...[
                Text('Vous êtes :', style: Theme.of(context).textTheme.titleLarge),
                const SizedBox(height: 8),
                Text(
                  roleLabel,
                  style: const TextStyle(fontSize: 28, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 20),
              ],
              ElevatedButton(
                onPressed: () {
                  final newReady = !s.youReadyLocal;
                  ctl.toggleReady(newReady);
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: s.youReadyLocal ? Colors.green : null,
                ),
                child: const Text('Je suis prêt'),
              ),
              const SizedBox(height: 12),
              waitingPanel,
            ],
          ),
        ),
      ),
    );
  }
}

class _ReadyTile extends StatelessWidget {
  final String name;
  final bool ready;
  final bool connected;
  const _ReadyTile({required this.name, required this.ready, required this.connected});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final icon = ready ? Icons.check_circle : Icons.hourglass_empty;
    final color = ready ? Colors.green : scheme.primary;
    return ConstrainedBox(
      constraints: const BoxConstraints(minWidth: 140, maxWidth: 180),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: scheme.surface,
          border: Border.all(color: scheme.outline.withValues(alpha: 0.25)),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, color: color, size: 18),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(name, overflow: TextOverflow.ellipsis),
                  const SizedBox(height: 2),
                  Text(
                    ready ? 'Prêt' : (connected ? 'En attente' : 'Hors ligne'),
                    style: Theme.of(context).textTheme.labelSmall,
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

class _WaitingPanel extends StatelessWidget {
  final int readyCount;
  final int total;
  final List<PlayerView> players;
  final String? meId;
  final bool isReadyLocal;
  const _WaitingPanel({
    required this.readyCount,
    required this.total,
    required this.players,
    required this.meId,
    required this.isReadyLocal,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          'En attente des autres joueurs',
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: 6),
        Text(
          'Prêts: $readyCount / $total',
          style: Theme.of(context).textTheme.bodyMedium,
        ),
        const SizedBox(height: 12),
        LayoutBuilder(
          builder: (ctx, _) {
            final shown = players.take(6).toList();
            final tiles = <Widget>[];
            for (var p in shown) {
              tiles.add(
                _ReadyTile(
                  name: p.id == meId ? '${p.id} (vous)' : p.id,
                  ready: (p.id == meId) ? (isReadyLocal || p.ready) : p.ready,
                  connected: p.connected,
                ),
              );
            }
            return Wrap(
              spacing: 12,
              runSpacing: 12,
              alignment: WrapAlignment.center,
              children: tiles,
            );
          },
        ),
      ],
    );
  }
}
