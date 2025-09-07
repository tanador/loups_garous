import 'package:shared_preferences/shared_preferences.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Contrôleur chargé de la persistance simple de la session via [SharedPreferences].
class SessionController {
  /// Restaure l'URL du serveur et les identifiants de partie/joueur s'ils existent.
  Future<Map<String, String?>> load() async {
    final prefs = await SharedPreferences.getInstance();
    return {
      'serverUrl': prefs.getString('serverUrl'),
      'gameId': prefs.getString('gameId'),
      'playerId': prefs.getString('playerId'),
    };
  }

  /// Sauvegarde les informations courantes de session.
  Future<void> save({required String serverUrl, String? gameId, String? playerId}) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('serverUrl', serverUrl);
    if (gameId != null) {
      await prefs.setString('gameId', gameId);
    } else {
      await prefs.remove('gameId');
    }
    if (playerId != null) {
      await prefs.setString('playerId', playerId);
    } else {
      await prefs.remove('playerId');
    }
  }

  /// Efface uniquement l'identifiant de partie et du joueur.
  Future<void> clearGame() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('gameId');
    await prefs.remove('playerId');
  }
}

/// Provider Riverpod exposant un [SessionController].
final sessionControllerProvider = Provider<SessionController>((ref) {
  return SessionController();
});
