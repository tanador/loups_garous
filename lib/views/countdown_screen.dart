import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../state/game_provider.dart';
import 'role_screen.dart';

// Écran de compte à rebours affiché avant la révélation des rôles.
class CountdownScreen extends ConsumerStatefulWidget {
  const CountdownScreen({super.key});

  @override
  ConsumerState<CountdownScreen> createState() => _CountdownScreenState();
}

class _CountdownScreenState extends ConsumerState<CountdownScreen> {
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(gameProvider);
    final now = DateTime.now().millisecondsSinceEpoch;
    final until = s.roleRevealUntilMs;
    final remainingMs = until == null ? 0 : (until - now);
    final remainingSec = remainingMs <= 0 ? 0 : (remainingMs / 1000).ceil();
    if (remainingSec <= 0) return const RoleScreen();

    return Scaffold(
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            FilmCountdown(number: remainingSec),
            const SizedBox(height: 24),
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 24.0),
              child: Text(
                'Révélation des rôles: Prenez votre téléphone et cachez votre écran !',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Simple old-fashioned film countdown style widget.
class FilmCountdown extends StatelessWidget {
  final int number;
  const FilmCountdown({super.key, required this.number});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 200,
      height: 200,
      child: Stack(
        alignment: Alignment.center,
        children: [
          Container(
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              border: Border.all(width: 4, color: Colors.grey),
            ),
          ),
          Container(width: 4, color: Colors.grey),
          Container(height: 4, width: double.infinity, color: Colors.grey),
          AnimatedSwitcher(
            duration: const Duration(milliseconds: 500),
            transitionBuilder: (child, anim) => FadeTransition(opacity: anim, child: child),
            child: Text(
              '$number',
              key: ValueKey(number),
              style: const TextStyle(fontSize: 80, fontWeight: FontWeight.bold),
            ),
          ),
        ],
      ),
    );
  }
}
