// This is a basic Flutter widget test.
//
// To perform an interaction with a widget in your test, use the WidgetTester
// utility in the flutter_test package. For example, you can send tap and scroll
// gestures. You can also use WidgetTester to find child widgets in the widget
// tree, read text, and verify that the values of widget properties are correct.

import 'package:flutter_test/flutter_test.dart';

import 'package:loup_garou_client/main.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

void main() {
  testWidgets('Affiche l\'écran de connexion au démarrage', (WidgetTester tester) async {
    // Prépare un stockage local mocké pour shared_preferences
    SharedPreferences.setMockInitialValues({});

    // Monte l'application réelle
    await tester.pumpWidget(const ProviderScope(child: App()));
    await tester.pumpAndSettle();

    // Vérifie la présence des éléments clés de l'écran de connexion
    expect(find.text('Connexion & Lobby'), findsOneWidget);
    expect(find.text('URL serveur (http://IP:3000)'), findsOneWidget);
    expect(find.text('Pseudonyme'), findsOneWidget);
    expect(find.textContaining('Parties en attente'), findsOneWidget);
  });
}
