import 'package:flutter_test/flutter_test.dart';
import 'package:les_loups_garous_de_tchernobyl/state/game_provider.dart';
import 'package:les_loups_garous_de_tchernobyl/state/models.dart';

GameModel _baseState({
  Role role = Role.VILLAGER,
  Set<String>? loversKnown,
  String? loverPartnerId,
}) {
  final players = const [
    PlayerView(id: 'me', connected: true, alive: true, ready: false),
    PlayerView(id: 'ally', connected: true, alive: true, ready: false),
  ];
  return GameModel.initial().copy(
    playerId: 'me',
    role: role,
    players: players,
    loversKnown: loversKnown ?? <String>{},
    loverPartnerId: loverPartnerId,
  );
}

void main() {
  group('shouldVibrateWake', () {
    test('vibrates for wolves during NIGHT_WOLVES only for wolves', () {
      final wolfState = _baseState(role: Role.WOLF);
      final villagerState = _baseState(role: Role.VILLAGER);

      expect(
        GameController.shouldVibrateWake(wolfState, GamePhase.NIGHT_WOLVES),
        isTrue,
      );
      expect(
        GameController.shouldVibrateWake(villagerState, GamePhase.NIGHT_WOLVES),
        isFalse,
      );
    });

    test('vibrates for role-specific wakes', () {
      expect(
        GameController.shouldVibrateWake(
          _baseState(role: Role.THIEF),
          GamePhase.NIGHT_THIEF,
        ),
        isTrue,
      );
      expect(
        GameController.shouldVibrateWake(
          _baseState(role: Role.CUPID),
          GamePhase.NIGHT_CUPID,
        ),
        isTrue,
      );
      expect(
        GameController.shouldVibrateWake(
          _baseState(role: Role.SEER),
          GamePhase.NIGHT_SEER,
        ),
        isTrue,
      );
      expect(
        GameController.shouldVibrateWake(
          _baseState(role: Role.WITCH),
          GamePhase.NIGHT_WITCH,
        ),
        isTrue,
      );
    });

    test('does not vibrate for mismatched roles', () {
      expect(
        GameController.shouldVibrateWake(
          _baseState(role: Role.VILLAGER),
          GamePhase.NIGHT_WITCH,
        ),
        isFalse,
      );
      expect(
        GameController.shouldVibrateWake(
          _baseState(role: Role.VILLAGER),
          GamePhase.NIGHT_SEER,
        ),
        isFalse,
      );
    });

    test('vibrates for lovers only when identified as lover', () {
      final loverKnown = _baseState(loversKnown: {'me'});
      final notLover = _baseState();

      expect(
        GameController.shouldVibrateWake(loverKnown, GamePhase.NIGHT_LOVERS),
        isTrue,
      );
      expect(
        GameController.shouldVibrateWake(notLover, GamePhase.NIGHT_LOVERS),
        isFalse,
      );
    });

    test('vibrates for everyone during morning and vote phases', () {
      final state = _baseState();
      expect(
        GameController.shouldVibrateWake(state, GamePhase.MORNING),
        isTrue,
      );
      expect(
        GameController.shouldVibrateWake(state, GamePhase.VOTE),
        isTrue,
      );
    });

    test('returns false for unrelated phases', () {
      final state = _baseState();
      expect(
        GameController.shouldVibrateWake(state, GamePhase.RESOLVE),
        isFalse,
      );
      expect(
        GameController.shouldVibrateWake(state, GamePhase.CHECK_END),
        isFalse,
      );
    });
  });
}
