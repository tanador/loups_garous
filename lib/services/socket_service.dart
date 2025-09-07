import 'dart:developer';
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
    socket.onConnect((_) => log('[socket] connected ${socket.id}'));
    socket.onDisconnect((_) => log('[socket] disconnected'));
    socket.onReconnect((n) => log('[socket] reconnect $n'));
    socket.onReconnectAttempt((_) => log('[socket] reconnect_attempt'));
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
  /// Un timeout est appliqué pour éviter de bloquer indéfiniment.
  Future<Map<String, dynamic>> emitAck(
     String event,
     Map<String, Object?> payload, {
      Duration timeout = const Duration(seconds: 8),
    })async {
    try {
      final res = await socket.emitWithAckAsync(event, payload).timeout(timeout);
      if (res is Map) {
        return res.map((k, v) => MapEntry(k.toString(), v));
      }
      return {'ok': false, 'error': 'bad_ack_format', 'got': res};
    } on TimeoutException {
      return {'ok': false, 'error': 'timeout'};
    }
  }

  /// Ferme proprement la connexion courante.
  void dispose() {
    _socket?.dispose();
    _socket = null;
  }
}
