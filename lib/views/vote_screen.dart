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
  bool _optimisticVoted = false;
  bool _isCasting = false;
  bool _isCancelling = false;
  bool _isAcking = false;

  @override
  void initState() {
    super.initState();
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(gameProvider);
    final ctl = ref.read(gameProvider.notifier);

    // Register listeners during build as required by WidgetRef.listen
    ref.listen<List<String>>(
      gameProvider.select((s) => s.voteAlive.map((e) => e.id).toList()),
      (prev, next) {
        final currentTarget = targetId;
        if (currentTarget == null) return;
        if (!next.contains(currentTarget)) {
          if (!mounted) return;
          setState(() {
            targetId = null;
            _optimisticVoted = false;
            _isCasting = false;
            _isCancelling = false;
            _isAcking = false;
          });
        }
      },
    );

    ref.listen<GamePhase>(
      gameProvider.select((s) => s.phase),
      (prev, next) {
        if (prev == next || !mounted) return;
        final enteringVote = prev != GamePhase.VOTE && next == GamePhase.VOTE;
        final leavingVote = prev == GamePhase.VOTE && next != GamePhase.VOTE;
        if (enteringVote || leavingVote) {
          setState(() {
            targetId = null;
            _optimisticVoted = false;
            _isCasting = false;
            _isCancelling = false;
            _isAcking = false;
          });
        }
      },
    );

    final isResolve = s.phase == GamePhase.RESOLVE;
    final you = s.playerId;
    final eliminated = s.lastVote?.eliminatedId;
    final youMustAck = isResolve && you != null && eliminated == you;

    final messenger = ScaffoldMessenger.of(context);

    Future<void> castVote() async {
      if (targetId == null || _isCasting) return;
      setState(() {
        _isCasting = true;
        _optimisticVoted = true; // feedback immédiat
      });
      String? err;
      try {
        err = await ctl.voteCast(targetId!);
      } catch (e) {
        err = e.toString();
      }
      if (!mounted) return;
      if (err != null) {
        setState(() {
          _isCasting = false;
          _optimisticVoted = false;
        });
        messenger.showSnackBar(SnackBar(content: Text(err)));
        return;
      }
      setState(() {
        _isCasting = false;
      });
    }

    Future<void> cancelVote() async {
      if (_isCancelling) return;
      setState(() {
        _isCancelling = true;
      });
      try {
        await ctl.voteCancel();
      } catch (e) {
        messenger.showSnackBar(SnackBar(content: Text(e.toString())));
      }
      if (!mounted) return;
      setState(() {
        _isCancelling = false;
        _optimisticVoted = false;
      });
    }

    Future<void> acknowledgeElimination() async {
      if (_isAcking) return;
      setState(() {
        _isAcking = true;
      });
      try {
        await ctl.voteAck();
      } catch (e) {
        messenger.showSnackBar(SnackBar(content: Text(e.toString())));
      }
      if (!mounted) return;
      setState(() {
        _isAcking = false;
      });
    }

    final serverVoted = s.youVoted;
    if (serverVoted && _optimisticVoted) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        setState(() => _optimisticVoted = false);
      });
    }

    final hasVoted = serverVoted || _optimisticVoted;
    final disableChoices = hasVoted || youMustAck;
    final bool showSpinner = _isCasting || _isCancelling || _isAcking;
    final String buttonLabel =
        youMustAck ? "J'ai vu" : (hasVoted ? 'Annuler mon vote' : 'Voter');
    String busyLabel;
    if (_isCancelling) {
      busyLabel = 'Annulation...';
    } else if (_isCasting) {
      busyLabel = 'Envoi...';
    } else {
      busyLabel = 'Patientez...';
    }

    VoidCallback? action;
    if (youMustAck) {
      action = _isAcking ? null : acknowledgeElimination;
    } else if (hasVoted) {
      action = _isCancelling ? null : cancelVote;
    } else {
      action = (targetId == null || _isCasting) ? null : castVote;
    }

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
              onChanged: (v) {
                if (disableChoices) return;
                setState(() => targetId = v);
              },
              child: Column(
                children: [
                  ...s.voteAlive.map(
                    (p) => RadioListTile<String?>(
                      title: Text(p.id),
                      value: p.id,
                      enabled: !disableChoices,
                    ),
                  ),
                ],
              ),
            ),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: action,
                style: ElevatedButton.styleFrom(
                  backgroundColor: youMustAck
                      ? Colors.orange
                      : (hasVoted ? Colors.green : null),
                ),
                child: showSpinner
                    ? Center(
                        child: Wrap(
                          alignment: WrapAlignment.center,
                          crossAxisAlignment: WrapCrossAlignment.center,
                          spacing: 8,
                          runSpacing: 4,
                          children: [
                            const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            ),
                            Text(
                              busyLabel,
                              textAlign: TextAlign.center,
                            ),
                          ],
                        ),
                      )
                    : Text(buttonLabel),
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
                final match = s.players
                    .where((p) => p.id == s.lastVote!.eliminatedId)
                    .toList();
                if (match.isNotEmpty) name = match.first.id;
                return Text('Éliminé: $name • rôle: ${s.lastVote!.role}');
              }),
              const SizedBox(height: 8),
              if (youMustAck)
                const Text('Appuyez sur « J\'ai vu » pour continuer.'),
              Builder(builder: (_) {
                final entries = s.lastVote!.tally.entries.map((e) {
                  String name = e.key;
                  final match = s.players.where((p) => p.id == e.key).toList();
                  if (match.isNotEmpty) name = match.first.id;
                  return '$name: ${e.value}';
                }).join(', ');
                return Text('Comptage: $entries');
              }),
            ]
          ],
        ),
      ),
    );
  }
}
