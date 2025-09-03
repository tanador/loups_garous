import 'dart:async';
import 'package:flutter/material.dart';
import 'role_screen.dart';

/// Displays a 10-second old fashioned film countdown before revealing roles.
class CountdownScreen extends StatefulWidget {
  const CountdownScreen({super.key});

  @override
  State<CountdownScreen> createState() => _CountdownScreenState();
}

class _CountdownScreenState extends State<CountdownScreen> {
  static const _start = 10;
  late int _seconds = _start;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (_seconds <= 0) {
        timer.cancel();
      } else {
        setState(() => _seconds--);
      }
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_seconds <= 0) return const RoleScreen();

    return Scaffold(
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            FilmCountdown(number: _seconds),
            const SizedBox(height: 24),
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 24.0),
              child: Text(
                'Prenez votre téléphone et cachez votre écran !',
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
