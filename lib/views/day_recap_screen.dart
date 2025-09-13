import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../state/game_provider.dart';
import 'widgets/common.dart';
import 'death_skull_animation.dart';

// Écran de récapitulatif après le vote de jour.
// Affiche l'élimination éventuelle et qui a voté pour qui.

class DayRecapScreen extends ConsumerStatefulWidget {
  const DayRecapScreen({super.key});
  @override
  ConsumerState<DayRecapScreen> createState() => _DayRecapScreenState();
}

class _DayRecapScreenState extends ConsumerState<DayRecapScreen> {
  bool _ack = false;
  bool _animPlayed = false;

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(gameProvider);
    final ctl = ref.read(gameProvider.notifier);
    final r = s.dayVoteRecap;

    // One-time skull animation if you just died from this vote
    final youId = s.playerId;
    final youDiedNow = youId != null && (r?.eliminated.contains(youId) ?? false);
    final playNow = (s.showDeathAnim && youDiedNow) && !_animPlayed;
    if (playNow) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        setState(() => _animPlayed = true);
        // Affiche l'animation plein écran et consomme le trigger.
        showDeathSkullOverlay(context);
        ctl.markDeathAnimShown();
      });
    }

    // Animated skull similar to DeadScreen, shown inline at top
    Widget? skull;
    if (playNow) {
      const base = Text('💀', style: TextStyle(fontSize: 80));
      skull = TweenAnimationBuilder<double>(
        tween: Tween(begin: 0.0, end: 1.0),
        duration: const Duration(milliseconds: 2200),
        curve: Curves.easeOutCubic,
        builder: (context, t, child) {
          final w = MediaQuery.of(context).size.width;
          final dx = (-0.35 * w) * (1.0 - t);
          final scale = 0.85 + 0.15 * t;
          return Opacity(
            opacity: t,
            child: Transform.translate(
              offset: Offset(dx, 0),
              child: Transform.scale(scale: scale, child: child),
            ),
          );
        },
        child: const Padding(
          padding: EdgeInsets.only(bottom: 12),
          child: base,
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Résultats du vote')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          DeadlineChip(deadlineMs: s.deadlineMs),
          const SizedBox(height: 8),
          if (skull != null) skull,
          if (r == null) const Text('Calcul des résultats...')
          else ...[
            if (r.eliminated.isEmpty)
              const Text('Aucune élimination (égalité).')
            else ...[
              const Text('Éliminé(s) :'),
              const SizedBox(height: 8),
              ...r.eliminated.map((pid) {
                String name = pid;
                final match = s.players.where((p) => p.id == pid).toList();
                if (match.isNotEmpty) name = match.first.id;
                return ListTile(
                  leading: const Icon(Icons.close),
                  title: Text(name),
                );
              })
            ],
            const SizedBox(height: 12),
            const Text('Votes :'),
            const SizedBox(height: 8),
            // Liste compacte (non scrollable) pour afficher immédiatement le bouton après
            // la liste des votes.
            ListView(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              children: [
                ...r.votes.map((v) {
                  String voter = v.$1;
                  String target = v.$2 ?? 'Abstention';
                  final mv = s.players.where((p) => p.id == v.$1).toList();
                  if (mv.isNotEmpty) voter = mv.first.id;
                  if (v.$2 != null) {
                    final mt = s.players.where((p) => p.id == v.$2).toList();
                    if (mt.isNotEmpty) target = mt.first.id;
                  }
                  return ListTile(
                    leading: const Icon(Icons.how_to_vote),
                    title: Text('$voter → $target'),
                  );
                })
              ],
            ),
            const SizedBox(height: 8),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: () {
                  final newAck = !_ack;
                  setState(() => _ack = newAck);
                  if (newAck) ctl.dayAck();
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: _ack ? Colors.green : null,
                ),
                child: const Text("J'ai lu"),
              ),
            )
          ]
        ]),
      ),
    );
  }
}
