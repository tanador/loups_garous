import '../utils/app_logger.dart';
import 'dart:async';
import 'package:socket_io_client/socket_io_client.dart' as io;

// Couche "services": classes auxiliaires indépendantes de l'UI.
// Ici, gestion d'une connexion Socket.IO réutilisable par le contrôleur de jeu.
/// Service léger encapsulant la logique de connexion à Socket.IO.
/// Il centralise l'ouverture, l'envoi d'évènements et la fermeture du socket.
class SocketService {
  io.Socket? _socket;

  /// Crée une connexion Socket.IO vers l'[url].
  ///
  /// Toute connexion précédente est d'abord fermée pour éviter les fuites.
  /// La connexion est configurée en WebSocket uniquement et n'est pas
  /// automatiquement ouverte: le contrôleur choisit quand appeler `connect()`.
  io.Socket connect(String url) {
    // Dispose previous connection if any before creating a new one
    _socket?.dispose();

    // force websocket; no polling
    final socket = io.io(
      url,
      io.OptionBuilder()
          .setTransports(['websocket'])
          .disableAutoConnect()
          .enableReconnection()
          .setReconnectionDelay(500)
          .build(),
    );
    socket.onConnect((_) => AppLogger.log('[socket] connected ${socket.id}',
        name: 'SocketService'));
    socket.onDisconnect(
        (_) => AppLogger.log('[socket] disconnected', name: 'SocketService'));
    socket.onReconnect(
        (n) => AppLogger.log('[socket] reconnect $n', name: 'SocketService'));
    socket.onReconnectAttempt((_) =>
        AppLogger.log('[socket] reconnect_attempt', name: 'SocketService'));
    // Do not connect yet; caller will initiate connection after registering listeners
    _socket = socket;
    return socket;
  }

  /// Récupère le socket courant ou lève une erreur si `connect` n'a pas été appelé.
  io.Socket get socket {
    final s = _socket;
    if (s == null) {
      throw StateError('Socket non initialisé. Appelez connect(url).');
    }
    return s;
  }

  /// Émet un évènement et attend un accusé de réception sous forme de Map.
  /// API officielle de socket_io_client 3.1.2: `emitWithAckAsync(event, data)` retourne un Future.
  Future<Map<String, dynamic>> emitAck(
    String event,
    Map<String, Object?> payload, {
    Duration timeout = const Duration(seconds: 8),
  }) async {
    try {
      final res =
          await socket.emitWithAckAsync(event, payload).timeout(timeout);
      if (res is Map) {
        return Map<String, dynamic>.from(
          res.map((k, v) => MapEntry(k.toString(), v)),
        );
      }
      return {'ok': false, 'error': 'bad_ack_format', 'got': res};
    } on TimeoutException {
      return {'ok': false, 'error': 'timeout'};
    } catch (e, st) {
      AppLogger.logError('[socket] emitAck error', e, st,
          name: 'SocketService');
      return {'ok': false, 'error': e.toString()};
    }
  }

  /// Ferme proprement la connexion courante.
  void dispose() {
    _socket?.dispose();
    _socket = null;
  }
}
