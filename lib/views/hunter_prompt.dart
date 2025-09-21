import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../state/game_provider.dart';
import '../state/models.dart';
import 'widgets/common.dart';

/// Shared widget rendering the hunter target selection.
///
/// Used both on the dedicated hunter screen and inline on the dead screen so
/// the player can always shoot as soon as the server emits `hunter:wake`.
class HunterPrompt extends ConsumerStatefulWidget {
  final EdgeInsets padding;
  final bool scrollable;
  final bool showHeading;

  const HunterPrompt({
    super.key,
    this.padding = EdgeInsets.zero,
    this.scrollable = false,
    this.showHeading = true,
  });

  @override
  ConsumerState<HunterPrompt> createState() => _HunterPromptState();
}

class _HunterPromptState extends ConsumerState<HunterPrompt> {
  String? targetId;

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(gameProvider);
    final ctl = ref.read(gameProvider.notifier);
    final List<Lite> targets = s.hunterTargets;
    final deadline = s.deadlineMs;

    Widget body;
    if (targets.isEmpty) {
      body = const Padding(
        padding: EdgeInsets.symmetric(vertical: 8),
        child: Text('En attente du serveur...', style: TextStyle(fontSize: 16)),
      );
    } else {
      final tiles = targets
          .map(
            (p) => RadioListTile<String?>(
              title: Text(p.id),
              value: p.id,
            ),
          )
          .toList();

      Widget optionsList = Column(children: tiles);
      if (widget.scrollable) {
        optionsList = ConstrainedBox(
          constraints: const BoxConstraints(maxHeight: 320),
          child: ListView(
            shrinkWrap: true,
            children: tiles,
          ),
        );
      }

      body = Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (widget.showHeading)
            const Text(
              'Qui souhaitez-vous tuer ?',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
            ),
          if (widget.showHeading) const SizedBox(height: 12),
          RadioGroup<String?>(
            groupValue: targetId,
            onChanged: (value) => setState(() => targetId = value),
            child: optionsList,
          ),
          const SizedBox(height: 12),
          ElevatedButton(
            onPressed: targetId == null
                ? null
                : () async {
                    try {
                      await ctl.hunterShoot(targetId!);
                    } finally {
                      if (mounted) setState(() => targetId = null);
                    }
                  },
            child: const Text('Tirer'),
          ),
        ],
      );
    }

    return Padding(
      padding: widget.padding,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          DeadlineChip(deadlineMs: deadline),
          const SizedBox(height: 12),
          body,
        ],
      ),
    );
  }
}
