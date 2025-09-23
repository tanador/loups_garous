import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:les_loups_garous_de_tchernobyl/main.dart';
import 'package:les_loups_garous_de_tchernobyl/state/game_provider.dart';
import 'package:les_loups_garous_de_tchernobyl/state/models.dart';
import 'package:les_loups_garous_de_tchernobyl/views/dead_screen.dart';
import 'package:les_loups_garous_de_tchernobyl/views/hunter_screen.dart';

class _TestGameController extends GameController {
  _TestGameController(this._mockState);

  final GameModel _mockState;

  @override
  GameModel build() => _mockState;
}

GameModel _buildHunterState({required bool hasTargets}) {
  final base = GameModel.initial();
  final players = <PlayerView>[
    const PlayerView(id: 'hunter', connected: true, alive: false),
    const PlayerView(id: 'ally', connected: true, alive: true),
  ];
  return base.copy(
    socketConnected: true,
    hasSnapshot: true,
    gameId: 'G1',
    playerId: 'hunter',
    phase: GamePhase.MORNING,
    players: players,
    hunterTargets: hasTargets ? const [Lite(id: 'ally')] : const <Lite>[],
    recap: const DayRecap(deaths: [], hunterKills: []),
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('Hunter screen is shown when hunter targets are available', (tester) async {
    final model = _buildHunterState(hasTargets: true);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          gameProvider.overrideWith(() => _TestGameController(model)),
        ],
        child: const App(),
      ),
    );
    await tester.pump();

    expect(find.byType(HunterScreen), findsOneWidget);
    expect(find.byType(DeadScreen), findsNothing);
  });

  testWidgets('Dead screen remains when no hunter targets are pending', (tester) async {
    final model = _buildHunterState(hasTargets: false);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          gameProvider.overrideWith(() => _TestGameController(model)),
        ],
        child: const App(),
      ),
    );
    await tester.pump();

    expect(find.byType(DeadScreen), findsOneWidget);
    expect(find.byType(HunterScreen), findsNothing);
  });

  testWidgets('Displays hunter pending banner for other players', (tester) async {
    final model = GameModel.initial().copy(
      socketConnected: true,
      hasSnapshot: true,
      gameId: 'G2',
      playerId: 'ally',
      phase: GamePhase.MORNING,
      players: const [
        PlayerView(id: 'hunter', connected: true, alive: false),
        PlayerView(id: 'ally', connected: true, alive: true),
      ],
      hunterPending: true,
      recap: const DayRecap(deaths: [], hunterKills: []),
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          gameProvider.overrideWith(() => _TestGameController(model)),
        ],
        child: const App(),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 250));

    expect(find.text('Le chasseur doit choisir une cible.'), findsOneWidget);
  });

  testWidgets('Hunter pending banner is hidden for the shooter', (tester) async {
    final model = GameModel.initial().copy(
      socketConnected: true,
      hasSnapshot: true,
      gameId: 'G3',
      playerId: 'hunter',
      phase: GamePhase.MORNING,
      players: const [
        PlayerView(id: 'hunter', connected: true, alive: false),
        PlayerView(id: 'ally', connected: true, alive: true),
      ],
      hunterTargets: const [Lite(id: 'ally')],
      hunterPending: true,
      recap: const DayRecap(deaths: [], hunterKills: []),
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          gameProvider.overrideWith(() => _TestGameController(model)),
        ],
        child: const App(),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 250));

    expect(find.text('Le chasseur doit choisir une cible.'), findsNothing);
  });
}
