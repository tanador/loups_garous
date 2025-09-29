import '../utils/app_logger.dart';
import 'dart:async';
import 'package:socket_io_client/socket_io_client.dart' as io;

// Couche "services": classes auxiliaires indépendantes de l'UI.
// Ici, gestion d'une connexion Socket.IO réutilisable par le contrôleur de jeu.
/// Service léger encapsulant la logique de connexion à Socket.IO.
/// Il centralise l'ouverture, l'envoi d'évènements et la fermeture du socket.
class SocketService {
  io.Socket? _socket;
  // Serialize acked emissions to avoid overlapping addStream bindings in
  // socket_io_client internals that can cause
  // "Bad state: StreamSink is bound to a Stream" in some race conditions.
  Future<void> _ackSerial = Future<void>.value();

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
    // Chain onto the previous emission to ensure only one is in flight
    // through the Socket.IO ack path at a time. This prevents the internal
    // StreamSink from being re-bound while an addStream is active.
    final completer = Completer<Map<String, dynamic>>();
    _ackSerial = _ackSerial.then((_) async {
      try {
        final res = await socket
            .emitWithAckAsync(event, payload)
            .timeout(timeout);
        if (res is Map) {
          completer.complete(Map<String, dynamic>.from(
            res.map((k, v) => MapEntry(k.toString(), v)),
          ));
          return;
        }
        completer.complete(
            {'ok': false, 'error': 'bad_ack_format', 'got': res});
      } on TimeoutException {
        completer.complete({'ok': false, 'error': 'timeout'});
      } catch (e, st) {
        AppLogger.logError('[socket] emitAck error', e, st,
            name: 'SocketService');
        completer.complete({'ok': false, 'error': e.toString()});
      }
    }).catchError((_) {
      // Swallow to keep the chain healthy; per-call result is already completed.
    });
    return completer.future;
  }

  /// Ferme proprement la connexion courante.
  void dispose() {
    _socket?.dispose();
    _socket = null;
  }
}
