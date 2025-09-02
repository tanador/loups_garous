import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../state/game_provider.dart';
import 'widgets/common.dart';

class VoteScreen extends ConsumerStatefulWidget {
  const VoteScreen({super.key});
  @override
  ConsumerState<VoteScreen> createState() => _VoteScreenState();
}

class _VoteScreenState extends ConsumerState<VoteScreen> {
  String? targetId; // null => abstention

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(gameProvider);
    final ctl = ref.read(gameProvider.notifier);

    return Scaffold(
      appBar: AppBar(title: const Text('Vote du village')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(children: [
          DeadlineChip(deadlineMs: s.deadlineMs),
          const SizedBox(height: 8),
          const Text('Choisissez quelqu’un à éliminer (ou abstenez-vous).'),
          const SizedBox(height: 8),
          Expanded(
            child: ListView(
              children: s.voteAlive
                  .map((p) => RadioListTile<String?>(
                        title: Text(p.nickname),
                        value: p.id,
                        groupValue: targetId,
                        onChanged: (v) => setState(() => targetId = v),
                      ))
                  .toList(),
            ),
          ),
          Row(children: [
            Expanded(
              child: OutlinedButton(
                onPressed: () => setState(() => targetId = null),
                child: const Text('S’abstenir'),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: ElevatedButton(
                onPressed: () => ctl.voteCast(targetId),
                child: const Text('Voter'),
              ),
            ),
          ]),
          const SizedBox(height: 12),
          if (s.lastVote != null) ...[
            const Divider(),
            Builder(builder: (_) {
              if (s.lastVote!.eliminatedId == null) {
                return const Text('Aucune élimination (égalité ou abstentions).');
              }
              String name = s.lastVote!.eliminatedId!;
              final match =
                  s.players.where((p) => p.id == s.lastVote!.eliminatedId).toList();
              if (match.isNotEmpty) name = match.first.nickname;
              return Text('Éliminé: $name • rôle: ${s.lastVote!.role}');
            }),
            const SizedBox(height: 8),
            Builder(builder: (_) {
              final entries = s.lastVote!.tally.entries
                  .map((e) {
                    String name = e.key;
                    final match = s.players.where((p) => p.id == e.key).toList();
                    if (match.isNotEmpty) name = match.first.nickname;
                    return '$name: ${e.value}';
                  })
                  .join(', ');
              return Text('Comptage: $entries');
            }),
          ]
        ]),
      ),
    );
  }
}
