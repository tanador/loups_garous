import 'dart:math' as math;
import 'package:flutter/material.dart';

/// DeathSkullAnimation
/// A self-contained jump-scare style animation suitable for the "player is dead" screen.
/// - No external assets: uses an emoji skull (💀) and particles.
/// - Effects: blackout background, heartbeat pulse, shock zoom, subtle shake, red glow, ash particles.
/// - Duration: ~1.6s then holds final frame; configurable.
///
/// Use either as a full-screen overlay or embed in an existing view.
/// Example (overlay):
///   showDeathSkullOverlay(context);
/// Example (inline):
///   const DeathSkullAnimation();
class DeathSkullAnimation extends StatefulWidget {
  const DeathSkullAnimation({
    super.key,
    this.duration = const Duration(milliseconds: 3000),
    this.backgroundColor = const Color(0xFF0B0B0D),
  });

  final Duration duration;
  final Color backgroundColor;

  @override
  State<DeathSkullAnimation> createState() => _DeathSkullAnimationState();
}

class _DeathSkullAnimationState extends State<DeathSkullAnimation>
    with SingleTickerProviderStateMixin {
  late final AnimationController _ctrl;

  // Curves for stages
  late final Animation<double> _blackout; // 0 -> 1 background darkness
  late final Animation<double> _heartbeat; // 0..1 pulse
  late final Animation<double> _shockZoom; // sudden scale pop
  late final Animation<double> _opacity; // skull opacity
  late final Animation<double> _shake; // small rotation
  late final Animation<double> _eyesGlow; // red glow intensity
  late final Animation<double> _particles; // particle emission progress

  @override
  void initState() {
    super.initState();
    _ctrl = AnimationController(vsync: this, duration: widget.duration)
      ..forward();

    // Timing breakdown (as fraction of total):
    // 0.00-0.15 blackout ramp, 0.05-0.35 heartbeat pulse, 0.25-0.40 shock zoom,
    // 0.20-0.35 opacity in, 0.25-0.50 shake, 0.28-0.45 eyes glow, 0.20-0.60 particles.
    _blackout = CurvedAnimation(
      parent: _ctrl,
      curve: const Interval(0.0, 0.15, curve: Curves.easeIn),
    );
    _heartbeat = CurvedAnimation(
      parent: _ctrl,
      curve: const Interval(0.05, 0.35, curve: Curves.easeInOutCubic),
    );
    _shockZoom = CurvedAnimation(
      parent: _ctrl,
      curve: const Interval(0.25, 0.40, curve: Curves.easeOutBack),
    );
    _opacity = CurvedAnimation(
      parent: _ctrl,
      curve: const Interval(0.20, 0.35, curve: Curves.easeIn),
    );
    _shake = CurvedAnimation(
      parent: _ctrl,
      curve: const Interval(0.25, 0.50, curve: Curves.elasticOut),
    );
    _eyesGlow = CurvedAnimation(
      parent: _ctrl,
      curve: const Interval(0.28, 0.45, curve: Curves.easeOutCubic),
    );
    _particles = CurvedAnimation(
      parent: _ctrl,
      curve: const Interval(0.20, 0.60, curve: Curves.easeOut),
    );
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _ctrl,
      builder: (context, _) {
        // Heartbeat pulse: 1.0 -> 1.02 -> 1.0
        final pulse = 1.0 + 0.02 * math.sin(_heartbeat.value * math.pi);
        // Shock zoom: quick 1.0 -> 1.18
        final shock = 1.0 + 0.18 * _shockZoom.value;
        final scale = pulse * shock;
        // Shake: slight rotation -3°..+3°
        final rot = (math.sin(_shake.value * math.pi * 2.0)) * (3 * math.pi / 180);
        // Red glow intensity
        final glow = (8.0 + 22.0 * _eyesGlow.value);

        return Container(
          color: Color.lerp(Colors.transparent, widget.backgroundColor, _blackout.value),
          child: Stack(
            fit: StackFit.expand,
            children: [
              // Ash particles layer
              CustomPaint(
                painter: _AshParticlesPainter(progress: _particles.value),
              ),

              // Centered skull with effects
              Center(
                child: Opacity(
                  opacity: _opacity.value.clamp(0.0, 1.0),
                  child: Transform.rotate(
                    angle: rot,
                    child: Transform.scale(
                      scale: scale,
                      child: _Skull(glowRadius: glow),
                    ),
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _Skull extends StatelessWidget {
  const _Skull({required this.glowRadius});
  final double glowRadius;

  @override
  Widget build(BuildContext context) {
    // Using a large emoji for cross-platform, no-asset skull.
    // Shadow simulates ominous red eye glow.
    return Text(
      '💀',
      textAlign: TextAlign.center,
      style: TextStyle(
        fontSize: 160,
        height: 1.0,
        shadows: [
          Shadow(color: Colors.red.withOpacity(0.35), blurRadius: glowRadius),
          Shadow(color: Colors.red.withOpacity(0.25), blurRadius: glowRadius * 0.6),
        ],
      ),
    );
  }
}

class _AshParticlesPainter extends CustomPainter {
  _AshParticlesPainter({required this.progress});

  final double progress; // 0..1
  static const int _count = 120;
  static const double _minSize = 1.0;
  static const double _maxSize = 2.8;

  @override
  void paint(Canvas canvas, Size size) {
    final rnd = math.Random(7); // stable distribution per frame; stylistic
    final center = Offset(size.width / 2, size.height / 2);
    final paint = Paint()..color = const Color(0x55FFFFFF);

    for (var i = 0; i < _count; i++) {
      // Deterministic pseudo-random scatter around the center.
      final angle = rnd.nextDouble() * math.pi * 2;
      final radius = (rnd.nextDouble() * 1.0 + 0.2) * (size.shortestSide * 0.5);
      // Particles move outward as progress increases; slight upward bias.
      final speed = Curves.easeOut.transform(progress);
      final dir = Offset(math.cos(angle), math.sin(angle) - 0.1);
      final pos = center + dir * radius * speed;

      final t = rnd.nextDouble();
      final sz = _minSize + (_maxSize - _minSize) * t;
      final opacity = (1.0 - progress).clamp(0.0, 1.0) * (0.6 + 0.4 * t);
      paint.color = Colors.white.withOpacity(opacity * 0.35);

      canvas.drawCircle(pos, sz, paint);
    }
  }

  @override
  bool shouldRepaint(covariant _AshParticlesPainter oldDelegate) {
    return oldDelegate.progress != progress;
  }
}

/// Shows the skull animation as a full-screen modal route over the current UI.
/// Call when the player dies.
Future<void> showDeathSkullOverlay(BuildContext context, {Duration? duration}) async {
  await Navigator.of(context).push(PageRouteBuilder<void>(
    opaque: false,
    barrierColor: Colors.black.withOpacity(0.85),
    pageBuilder: (_, __, ___) => _DeathOverlayPage(duration: duration ?? const Duration(milliseconds: 3000)),
    transitionsBuilder: (_, anim, __, child) {
      // Quick fade-in; the widget manages most motion.
      return FadeTransition(opacity: CurvedAnimation(parent: anim, curve: Curves.easeIn), child: child);
    },
  ));
}

class _DeathOverlayPage extends StatefulWidget {
  const _DeathOverlayPage({required this.duration});
  final Duration duration;

  @override
  State<_DeathOverlayPage> createState() => _DeathOverlayPageState();
}

class _DeathOverlayPageState extends State<_DeathOverlayPage> {
  bool _showText = false;

  @override
  void initState() {
    super.initState();
    // Révèle le texte juste après la fin de l'animation principale.
    Future.delayed(widget.duration).then((_) {
      if (!mounted) return;
      setState(() => _showText = true);
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      body: SafeArea(
        child: Stack(
          fit: StackFit.expand,
          children: [
            DeathSkullAnimation(duration: widget.duration),
            // Texte qui apparaît progressivement au-dessus de la tête
            Align(
              alignment: const Alignment(0, -0.45),
              child: AnimatedOpacity(
                opacity: _showText ? 1.0 : 0.0,
                duration: const Duration(milliseconds: 700),
                curve: Curves.easeOutCubic,
                child: AnimatedSlide(
                  offset: _showText ? Offset.zero : const Offset(0, -0.08),
                  duration: const Duration(milliseconds: 700),
                  curve: Curves.easeOutCubic,
                  child: const Text(
                    'Vous êtes mort',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 28,
                      fontWeight: FontWeight.w700,
                      color: Colors.white,
                      letterSpacing: 0.5,
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
