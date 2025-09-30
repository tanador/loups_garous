import 'dart:async';
import 'dart:convert';

import 'package:socket_io_client/socket_io_client.dart' as io;

import '../utils/app_logger.dart';

// Couche "services": classes auxiliaires indépendantes de l'UI.
// Ici, gestion d'une connexion Socket.IO réutilisable par le contrôleur de jeu.
/// Service léger encapsulant la logique de connexion à Socket.IO.
/// Il centralise l'ouverture, l'envoi d'événements et la fermeture du socket.
class SocketService {
  static const _logName = 'SocketService';
  static const Set<String> _knownErrorEvents = {
    'connect_error',
    'connect_timeout',
    'disconnect',
    'disconnecting',
    'error',
    'reconnect_error',
    'reconnect_failed',
  };

  io.Socket? _socket;
  // Serialize acked emissions to avoid overlapping addStream bindings in
  // socket_io_client internals that can cause
  // "Bad state: StreamSink is bound to a Stream" in some race conditions.
  Future<void> _ackSerial = Future<void>.value();
  int _serverLogLevel = 3;

  void setServerLogLevel(int level) {
    if (level < 0) {
      _serverLogLevel = 0;
    } else if (level > 3) {
      _serverLogLevel = 3;
    } else {
      _serverLogLevel = level;
    }
  }

  /// Crée une connexion Socket.IO vers l'[url].
  ///
  /// Toute connexion précédente est d'abord fermée pour éviter les fuites.
  /// La connexion est configurée en WebSocket uniquement et n'est pas
  /// automatiquement ouverte: le contrôleur choisit quand appeler `connect()`.
  io.Socket connect(String url) {
    _socket?.dispose();

    final socket = io.io(
      url,
      io.OptionBuilder()
          .setTransports(['websocket'])
          .disableAutoConnect()
          .enableReconnection()
          .setReconnectionDelay(500)
          .build(),
    );
    socket.onConnect((_) =>
        AppLogger.log('[socket] connected ${socket.id}', name: _logName));
    socket.onDisconnect(
        (_) => AppLogger.log('[socket] disconnected', name: _logName));
    socket.onReconnect(
        (n) => AppLogger.log('[socket] reconnect $n', name: _logName));
    socket.onReconnectAttempt(
        (_) => AppLogger.log('[socket] reconnect_attempt', name: _logName));
    socket.onAny(_handleIncomingEvent);
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

  /// Emet un evenement et attend un accuse de reception sous forme de Map.
  /// Utilise emitWithAck (callback) pour eviter le bug "StreamSink is bound to a Stream"
  /// observe avec emitWithAckAsync dans socket_io_client 3.1.x et retente une fois apres un court delai
  /// pour laisser le flux interne se liberer.
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
      final ackCompleter = Completer<Map<String, dynamic>>();
      Timer? timer;

      void complete(Map<String, dynamic> value) {
        if (!ackCompleter.isCompleted) {
          ackCompleter.complete(value);
        }
      }

      var attempt = 0;
      while (true) {
        try {
          timer = Timer(timeout, () {
            complete({'ok': false, 'error': 'timeout'});
          });
          socket.emitWithAck(
            event,
            payload,
            ack: (dynamic res) {
              timer?.cancel();
              if (res is Map) {
                complete(Map<String, dynamic>.from(
                  res.map((k, v) => MapEntry(k.toString(), v)),
                ));
                return;
              }
              complete({'ok': false, 'error': 'bad_ack_format', 'got': res});
            },
          );
          break;
        } catch (e, st) {
          timer?.cancel();
          final message = e.toString();
          final isStreamBoundError =
              e is StateError && message.contains('StreamSink is bound to a Stream');
          if (isStreamBoundError && attempt == 0) {
            attempt += 1;
            await Future<void>.delayed(const Duration(milliseconds: 12));
            continue;
          }
          AppLogger.logError('[socket] emitAck error', e, st, name: _logName);
          complete({'ok': false, 'error': message});
          return;
        }
      }

      final ack = await ackCompleter.future;
      if (!completer.isCompleted) {
        completer.complete(ack);
      }
    }).catchError((e, st) {
      AppLogger.logError('[socket] ack queue error', e, st, name: _logName);
      if (!completer.isCompleted) {
        completer.complete({'ok': false, 'error': e.toString()});
      }
    });
    return completer.future;
  }

  /// Ferme proprement la connexion courante.
  void dispose() {
    _socket?.dispose();
    _socket = null;
  }

  void _handleIncomingEvent(String event, dynamic data) {
    final level = _serverLogLevel;
    if (level <= 0) {
      return;
    }
    final isError = _isErrorEvent(event, data);
    if (level == 1 && !isError) {
      return;
    }
    if (level == 3 && !isError) {
      AppLogger.log('[srv][summary] $event', name: _logName);
      return;
    }
    final payload = _stringifyPayload(data);
    final prefix = isError ? '[srv][error]' : '[srv]';
    AppLogger.log('$prefix $event payload=$payload', name: _logName);
  }

  bool _isErrorEvent(String event, dynamic data) {
    final lower = event.toLowerCase();
    if (_knownErrorEvents.contains(lower) || lower.contains('error')) {
      return true;
    }
    final map = _extractMapFromPayload(data);
    if (map == null) {
      return false;
    }
    if (map['ok'] == false) {
      return true;
    }
    return map.containsKey('error');
  }

  Map<String, dynamic>? _extractMapFromPayload(dynamic data) {
    if (data is Map) {
      return data.map((key, value) => MapEntry(key.toString(), value));
    }
    if (data is List && data.isNotEmpty && data.first is Map) {
      final first = data.first as Map;
      return first.map((key, value) => MapEntry(key.toString(), value));
    }
    return null;
  }

  String _stringifyPayload(dynamic data) {
    if (data == null) {
      return 'null';
    }
    try {
      return jsonEncode(data);
    } catch (_) {
      if (data is Map) {
        final entries = data.entries
            .map((e) => '${e.key}:${_stringifyPayload(e.value)}')
            .join(', ');
        return '{$entries}';
      }
      if (data is Iterable) {
        return '[${data.map(_stringifyPayload).join(', ')}]';
      }
      return data.toString();
    }
  }
}
