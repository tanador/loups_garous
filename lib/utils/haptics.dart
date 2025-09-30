import 'dart:async';
import 'package:flutter/foundation.dart'
    show kIsWeb, defaultTargetPlatform, TargetPlatform;
import 'package:flutter/services.dart';
import 'package:vibration/vibration.dart';

/// Adapte un pattern de vibration de style Android (pulses/pulseMs/pauseMs)
/// en une séquence de haptics iOS basée sur `HapticFeedback.mediumImpact()`.
///
/// Objectif: ressentis plus homogènes sur iOS où l'amplitude/durée ne sont
/// pas configurables. Sur Android, on conserve le pattern via le plugin.
class HapticsPatternAdapter {
  /// Joue un pattern adapté à la plateforme.
  /// - iOS: approximation via impacts `mediumImpact()` espacés.
  /// - Android: utilise le plugin `vibration` avec pattern/intensités si dispo.
  static Future<void> play({
    required int pulses,
    required int pulseMs,
    required int pauseMs,
    int amplitude = 128,
  }) async {
    if (pulses <= 0 || pulseMs < 0 || pauseMs < 0) return;
    if (!kIsWeb && defaultTargetPlatform == TargetPlatform.iOS) {
      await _playIosApprox(pulses: pulses, pulseMs: pulseMs, pauseMs: pauseMs);
      return;
    }

    // Android / autres plateformes avec plugin
    try {
      if (await Vibration.hasVibrator()) {
        final supportsCustom = await Vibration.hasCustomVibrationsSupport();
        final supportsAmplitude = await Vibration.hasAmplitudeControl();
        final clampedAmp = amplitude < 1
            ? 1
            : (amplitude > 255 ? 255 : amplitude);
        final pattern = <int>[0];
        final intensities = <int>[0];
        for (var i = 0; i < pulses; i++) {
          pattern.add(pulseMs);
          intensities.add(clampedAmp);
          if (i < pulses - 1) {
            pattern.add(pauseMs);
            intensities.add(0);
          }
        }
        if (supportsCustom) {
          if (supportsAmplitude) {
            await Vibration.vibrate(pattern: pattern, intensities: intensities);
          } else {
            await Vibration.vibrate(pattern: pattern);
          }
        } else {
          final total = _totalDuration(pulses, pulseMs, pauseMs);
          if (total > 0) {
            if (supportsAmplitude) {
              await Vibration.vibrate(duration: total, amplitude: clampedAmp);
            } else {
              await Vibration.vibrate(duration: total);
            }
          }
        }
        return;
      }
    } catch (_) {}

    // Fallback générique: impacts medium espacés selon le pattern
    await _playIosApprox(pulses: pulses, pulseMs: pulseMs, pauseMs: pauseMs);
  }

  /// Approximation iOS: transforme chaque pulse en N impacts medium espacés.
  /// - Espace par impact: ~80 ms par défaut (fiable sur iOS).
  /// - Au moins 1 impact par pulse, même si `pulseMs` est très court.
  static Future<void> _playIosApprox({
    required int pulses,
    required int pulseMs,
    required int pauseMs,
  }) async {
    const gapMs = 80; // espacement entre impacts medium
    for (var i = 0; i < pulses; i++) {
      final taps = pulseMs <= 0 ? 1 : (pulseMs / gapMs).clamp(1, 20).round();
      for (var j = 0; j < taps; j++) {
        try {
          await HapticFeedback.mediumImpact();
        } catch (_) {}
        if (j < taps - 1) {
          await Future.delayed(const Duration(milliseconds: gapMs));
        }
      }
      if (i < pulses - 1 && pauseMs > 0) {
        await Future.delayed(Duration(milliseconds: pauseMs));
      }
    }
  }

  static int _totalDuration(int pulses, int pulseMs, int pauseMs) {
    if (pulses <= 0 || pulseMs <= 0) return 0;
    final between = pulses > 1 ? (pulses - 1) * (pauseMs < 0 ? 0 : pauseMs) : 0;
    return pulses * pulseMs + between;
  }
}
