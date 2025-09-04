import 'dart:developer';
import 'dart:async';
import 'package:socket_io_client/socket_io_client.dart' as io;

class SocketService {
  io.Socket? _socket;

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

  io.Socket get socket {
    final s = _socket;
    if (s == null) {
      throw StateError('Socket non initialisé. Appelez connect(url).');
    }
    return s;
  }

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

  void dispose() {
    _socket?.dispose();
    _socket = null;
  }
}
