import 'package:flutter/material.dart';

class DeadlineChip extends StatelessWidget {
  final int? deadlineMs;
  const DeadlineChip({super.key, required this.deadlineMs});

  @override
  Widget build(BuildContext context) {
    if (deadlineMs == null) return const SizedBox.shrink();
    final remain = deadlineMs! - DateTime.now().millisecondsSinceEpoch;
    final secs = (remain / 1000).clamp(0, 999).toInt();
    return Chip(
      avatar: const Icon(Icons.timer, size: 16),
      label: Text('$secs s'),
    );
  }
}
