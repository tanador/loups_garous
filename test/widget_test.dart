// This is a basic Flutter widget test.
//
// To perform an interaction with a widget in your test, use the WidgetTester
// utility in the flutter_test package. For example, you can send tap and scroll
// gestures. You can also use WidgetTester to find child widgets in the widget
// tree, read text, and verify that the values of widget properties are correct.

import 'package:flutter_test/flutter_test.dart';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:les_loups_garous_de_tchernobyl/main.dart';
import 'package:les_loups_garous_de_tchernobyl/state/game_provider.dart';
import 'package:les_loups_garous_de_tchernobyl/state/models.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  testWidgets('Affiche l\'écran de connexion au démarrage',
      (WidgetTester tester) async {
    // Prépare un stockage local mocké pour shared_preferences
    SharedPreferences.setMockInitialValues({});

    // Monte l'application réelle
    await tester.pumpWidget(ProviderScope(child: const App()));
    await tester.pumpAndSettle();

    // Vérifie la présence des éléments clés de l'écran de connexion
    expect(find.text('Connexion & Lobby'), findsOneWidget);
    expect(find.text('URL serveur (http://IP:3000)'), findsOneWidget);
    expect(find.text('Pseudonyme'), findsOneWidget);
    expect(find.textContaining('Parties en attente'), findsOneWidget);
  });

  testWidgets(
      'Retour à l\'accueil depuis la fin de partie renvoie à la connexion',
      (WidgetTester tester) async {
    SharedPreferences.setMockInitialValues({});

    await tester.pumpWidget(ProviderScope(child: const App()));
    await tester.pumpAndSettle();

    final context = tester.element(find.byType(App));
    final container = ProviderScope.containerOf(context, listen: false);
    final controller = container.read(gameProvider.notifier);

    controller.state = controller.state.copy(
      gameId: 'game-1',
      playerId: 'Alice',
      hasSnapshot: true,
      phase: GamePhase.END,
      winner: 'VILLAGE',
      finalRoles: const [
        ('Alice', Role.VILLAGER),
        ('Bob', Role.WOLF),
      ],
      players: const [
        PlayerView(id: 'Alice', connected: true, alive: true),
        PlayerView(id: 'Bob', connected: true, alive: false),
      ],
    );

    await tester.pumpAndSettle();

    expect(find.text('Fin de partie'), findsOneWidget);

    await tester.tap(find.text("Retour à l'accueil"));
    await tester.pumpAndSettle();

    expect(find.text('Connexion & Lobby'), findsOneWidget);
    expect(find.text('Fin de partie'), findsNothing);
  });
}
