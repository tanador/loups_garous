import 'dart:async';
import 'dart:io';
import 'dart:developer' as developer;

/// Centralized logger that can mirror all messages into a file while keeping
/// the standard developer.log output available for debugging.
class AppLogger {
  static bool _initialized = false;
  static IOSink? _sink;
  static String? _filePath;

  /// Initializes the logger if the `LG_CLIENT_LOG_FILE` environment variable is set.
  static void initFromEnv() {
    if (_initialized) {
      return;
    }
    _initialized = true;
    final path = Platform.environment['LG_CLIENT_LOG_FILE'];
    if (path == null || path.isEmpty) {
      return;
    }
    try {
      final file = File(path);
      file.createSync(recursive: true);
      _sink = file.openWrite(mode: FileMode.append);
      _filePath = file.path;
      log('logging to ${file.path}', name: 'AppLogger');
    } catch (err, stack) {
      developer.log('Failed to initialize file logging: $err',
          name: 'AppLogger', stackTrace: stack);
    }
  }

  /// Writes a message to the optional log file and to developer.log.
  static void log(String message,
      {String name = 'APP', Object? error, StackTrace? stackTrace}) {
    final ts = DateTime.now().toIso8601String();
    final line = '$ts [$name] $message';
    if (_sink != null) {
      _sink!.writeln(line);
      if (error != null) {
        _sink!.writeln('$ts [$name][ERROR] $error');
      }
      if (stackTrace != null) {
        _sink!.writeln(stackTrace.toString());
      }
      _sink!.flush();
    }
    developer.log(message, name: name, error: error, stackTrace: stackTrace);
  }

  /// Convenience helper to log errors with a consistent prefix.
  static void logError(String context, Object error, StackTrace? stackTrace,
      {String name = 'APP'}) {
    log('$context: $error', name: name, error: error, stackTrace: stackTrace);
  }

  /// Ensures the sink is closed when the process terminates.
  static Future<void> dispose() async {
    if (_sink != null) {
      try {
        await _sink!.flush();
        await _sink!.close();
      } catch (_) {}
    }
    _sink = null;
  }

  static String? get logFilePath => _filePath;
}
