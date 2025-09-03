import 'dart:async';

import 'package:flutter/material.dart';

class DeadlineChip extends StatefulWidget {
  final int? deadlineMs;
  const DeadlineChip({super.key, required this.deadlineMs});

  @override
  State<DeadlineChip> createState() => _DeadlineChipState();
}

class _DeadlineChipState extends State<DeadlineChip> {
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    if (widget.deadlineMs != null) {
      _timer = Timer.periodic(const Duration(seconds: 1), (_) {
        setState(() {});
      });
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final deadlineMs = widget.deadlineMs;
    if (deadlineMs == null) return const SizedBox.shrink();
    final remain = deadlineMs - DateTime.now().millisecondsSinceEpoch;
    final secs = (remain / 1000).clamp(0, 999).toInt();
    return Chip(
      avatar: const Icon(Icons.timer, size: 16),
      label: Text('$secs s'),
    );
  }
}
