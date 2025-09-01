import 'dart:developer';
import 'dart:async';
import 'package:socket_io_client/socket_io_client.dart' as IO;

class SocketService {
  IO.Socket? _socket;

  IO.Socket connect(String url) {
    // force websocket; no polling
    final socket = IO.io(
      url,
      IO.OptionBuilder()
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
    socket.connect();
    _socket = socket;
    return socket;
  }

  IO.Socket get socket {
    final s = _socket;
    if (s == null) {
      throw StateError('Socket non initialisé. Appelez connect(url).');
    }
    return s;
  }

  Future<Map<String, dynamic>> emitAck(IO.Socket socket, String event, dynamic payload,
      {Duration timeout = const Duration(seconds: 8)}) async {
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
