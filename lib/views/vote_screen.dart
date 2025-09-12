import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../state/game_provider.dart';
import '../state/models.dart';
import 'widgets/common.dart';

// Écran du village pour voter contre un joueur pendant la journée.

class VoteScreen extends ConsumerStatefulWidget {
  const VoteScreen({super.key});
  @override
  ConsumerState<VoteScreen> createState() => _VoteScreenState();
}

class _VoteScreenState extends ConsumerState<VoteScreen> {
  String? targetId;
  bool _voted = false;

  @override
  Widget build(BuildContext context) {
    // Reset the local vote when the list of alive players changes.
    ref.listen<GameModel>(gameProvider, (prev, next) {
      if (prev?.voteAlive != next.voteAlive) {
        setState(() {
          targetId = null;
          _voted = false;
        });
      }
    });

    final s = ref.watch(gameProvider);
    final ctl = ref.read(gameProvider.notifier);

    final isResolve = s.phase == GamePhase.RESOLVE;
    final you = s.playerId;
    final eliminated = s.lastVote?.eliminatedId;
    final youMustAck = isResolve && you != null && eliminated == you;

    final messenger = ScaffoldMessenger.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Vote du village')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: ListView(
          children: [
            DeadlineChip(deadlineMs: s.deadlineMs),
            const SizedBox(height: 8),
            const Text('Choisissez quelqu’un à éliminer.'),
            const SizedBox(height: 8),
            RadioGroup<String?>(
              groupValue: targetId,
              onChanged: (v) { if(!_voted && !youMustAck) setState(() => targetId = v); },
              child: Column(
                children: [
                  ...s.voteAlive.map(
                    (p) => RadioListTile<String?>(
                      title: Text(p.id),
                      value: p.id,
                      enabled: !_voted && !youMustAck,
                    ),
                  ),
                ],
              ),
            ),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: youMustAck
                    ? () {
                        ctl.voteAck();
                      }
                    : (targetId == null && !_voted
                        ? null
                        : () {
                            if (_voted) {
                              ctl.voteCancel();
                              setState(() {
                                _voted = false;
                                targetId = null;
                              });
                        } else if (targetId != null) {
                          () async {
                            final err = await ctl.voteCast(targetId!);
                            if (!mounted) return;
                            if (err == null) {
                              setState(() => _voted = true);
                            } else {
                              messenger.showSnackBar(
                                SnackBar(content: Text(err)),
                              );
                            }
                          }();
                        }
                      }),
                style: ElevatedButton.styleFrom(
                  backgroundColor: youMustAck
                      ? Colors.orange
                      : (_voted ? Colors.green : null),
                ),
                child: Text(
                  youMustAck
                      ? "J'ai vu"
                      : (_voted ? 'Annuler mon vote' : 'Voter'),
                ),
              ),
            ),
            const SizedBox(height: 12),
            if (s.lastVote != null) ...[
              const Divider(),
              Builder(builder: (_) {
                if (s.lastVote!.eliminatedId == null) {
                  return const Text('Égalité, veuillez revoter.');
                }
                String name = s.lastVote!.eliminatedId!;
                final match =
                    s.players.where((p) => p.id == s.lastVote!.eliminatedId).toList();
                if (match.isNotEmpty) name = match.first.id;
                return Text('Éliminé: $name • rôle: ${s.lastVote!.role}');
              }),
              const SizedBox(height: 8),
              if (youMustAck)
                const Text('Appuyez sur « J\'ai vu » pour continuer.'),
              Builder(builder: (_) {
                final entries = s.lastVote!.tally.entries
                    .map((e) {
                      String name = e.key;
                      final match =
                          s.players.where((p) => p.id == e.key).toList();
                      if (match.isNotEmpty) name = match.first.id;
                      return '$name: ${e.value}';
                    })
                    .join(', ');
                return Text('Comptage: $entries');
              }),
            ]
          ],
        ),
      ),
    );
  }
}
