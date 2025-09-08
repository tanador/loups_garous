import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../state/game_provider.dart';

/// Écran affiché lorsque les amoureux sont réveillés par Cupidon.
/// Il informe le joueur de l'identité de son partenaire.
class NightLoversScreen extends ConsumerStatefulWidget {
  const NightLoversScreen({super.key});

  @override
  ConsumerState<NightLoversScreen> createState() => _NightLoversScreenState();
}

class _NightLoversScreenState extends ConsumerState<NightLoversScreen> {
  bool _acked = false;

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(gameProvider);
    final ctl = ref.read(gameProvider.notifier);
    final partnerId = s.loverPartnerId;
    return Scaffold(
      appBar: AppBar(title: const Text('Amoureux')),
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('Vous tombez amoureux...'),
            const SizedBox(height: 12),
            if (partnerId != null)
              Text('Votre partenaire est $partnerId ❤️',
                  style: const TextStyle(fontSize: 20)),
            const SizedBox(height: 24),
            ElevatedButton.icon(
              style: ElevatedButton.styleFrom(
                backgroundColor: _acked ? Colors.green : null,
              ),
              onPressed: _acked
                  ? null
                  : () async {
                      setState(() => _acked = true);
                      try {
                        await ctl.loversAck();
                      } catch (_) {}
                    },
              icon: Icon(_acked ? Icons.check_circle : Icons.check_circle_outline),
              label: const Text("J'ai lu"),
            ),
            const SizedBox(height: 8),
            const Text('Fermez les yeux'),
          ],
        ),
      ),
    );
  }
}
