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
            Text(s.lastVote!.eliminatedId == null
                ? 'Aucune élimination (égalité ou abstentions).'
                : 'Éliminé: ${s.lastVote!.eliminatedId} • rôle: ${s.lastVote!.role}'),
            const SizedBox(height: 8),
            Text('Comptage: ${s.lastVote!.tally}'),
          ]
        ]),
      ),
    );
  }
}
