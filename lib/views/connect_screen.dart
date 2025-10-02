import 'dart:async';
import 'dart:io';
import 'dart:math';
import 'package:flutter/foundation.dart' show kIsWeb;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../state/game_provider.dart';
import '../utils/app_logger.dart';
import 'game_options_screen.dart';

String? _cliArgumentValue(List<String> args, String flag, [String? alias]) {
  String? extract(String candidate) {
    final eqPrefix = '$candidate=';
    for (var i = 0; i < args.length; i++) {
      final arg = args[i];
      if (arg == candidate) {
        if (i + 1 < args.length) {
          final value = args[i + 1].trim();
          if (value.isNotEmpty) return value;
        }
      } else if (arg.startsWith(eqPrefix)) {
        final value = arg.substring(eqPrefix.length).trim();
        if (value.isNotEmpty) return value;
      }
    }
    return null;
  }

  String? value = extract(flag);
  if (value != null && value.isNotEmpty) return value;
  if (alias != null) {
    value = extract(alias);
    if (value != null && value.isNotEmpty) return value;
  }
  return null;
}

bool? _parseBoolString(String? raw) {
  if (raw == null) return null;
  final normalized = raw.trim().toLowerCase();
  if (normalized.isEmpty) return null;
  if (normalized == '1' ||
      normalized == 'true' ||
      normalized == 'yes' ||
      normalized == 'y' ||
      normalized == 'on') {
    return true;
  }
  if (normalized == '0' ||
      normalized == 'false' ||
      normalized == 'no' ||
      normalized == 'n' ||
      normalized == 'off') {
    return false;
  }
  return null;
}

bool? _tryReadEnvFlag(List<String> keys) {
  if (kIsWeb) return null;
  try {
    final env = Platform.environment;
    for (final key in keys) {
      final parsed = _parseBoolString(env[key]);
      if (parsed != null) {
        return parsed;
      }
    }
  } catch (_) {}
  return null;
}

bool? _cliFlag(
  List<String> args,
  String flag, {
  List<String> aliases = const [],
  List<String> negations = const [],
}) {
  final names = <String>[flag, ...aliases];
  final negs = <String>[...negations];
  for (var i = 0; i < args.length; i++) {
    final arg = args[i];
    if (negs.contains(arg)) return false;
    for (final name in names) {
      if (arg == name) {
        if (i + 1 < args.length) {
          final parsed = _parseBoolString(args[i + 1]);
          if (parsed != null) return parsed;
        }
        return true;
      }
      final prefix = '$name=';
      if (arg.startsWith(prefix)) {
        final parsed = _parseBoolString(arg.substring(prefix.length));
        if (parsed != null) return parsed;
      }
    }
  }
  return null;
}

// Parametres de lancement (lecture a l'execution)
// _paramNick     -> force le pseudo par defaut
// _autoCreate    -> active la creation auto (ou rejoint si une partie existe)
// _autoJoin      -> rejoint automatiquement la premiere partie disponible
//
// Sources prises en compte
// - Pseudo: dart-define (compat: PSEUDO) ou argument CLI `--paramNick`.
// - Auto-create/Auto-max: argument CLI (`--autoCreate`, `--autoMaxPlayers`), variables d'environnement,
//   ou dart-define (compat: AUTO_CREATE / AUTO_MAX_PLAYERS).
// - Auto-join: argument CLI (`--autoJoin`), variables d'environnement, ou dart-define (compat: AUTO_JOIN).

final String _paramNick = (() {
  const byKey = String.fromEnvironment('_paramNick', defaultValue: '');
  if (byKey.isNotEmpty) return byKey;
  const legacy = String.fromEnvironment('PSEUDO', defaultValue: '');
  if (legacy.isNotEmpty) return legacy;
  if (!kIsWeb) {
    try {
      final env = Platform.environment;
      final envNick = (env['_paramNick'] ??
              env['_PARAMNICK'] ??
              env['PSEUDO'] ??
              env['LG_PARAM_NICK'] ??
              '')
          .trim();
      if (envNick.isNotEmpty) {
        return envNick.replaceAll('"', '');
      }
    } catch (_) {}
    final cliValue = _cliArgumentValue(
        Platform.executableArguments, '--paramNick', '--nick');
    if (cliValue != null && cliValue.trim().isNotEmpty) {
      return cliValue.trim().replaceAll('"', '');
    }
  }
  return '';
})();

final bool _autoCreate = (() {
  if (!kIsWeb) {
    final cliFlag = _cliFlag(
      Platform.executableArguments,
      '--autoCreate',
      aliases: const ['--auto-create'],
      negations: const ['--no-autoCreate', '--no-auto-create'],
    );
    if (cliFlag != null) return cliFlag;
  }
  final fromEnv = _tryReadEnvFlag(const [
    '_autoCreate',
    '_AUTOCREATE',
    'AUTOCREATE',
    'AUTO_CREATE',
  ]);
  if (fromEnv != null) {
    return fromEnv;
  }
  const byKey = bool.fromEnvironment('_autoCreate', defaultValue: false);
  const legacy = bool.fromEnvironment('AUTO_CREATE', defaultValue: false);
  return byKey || legacy;
})();

// Nombre de joueurs pour l'auto-création (si _autoCreate est activé).
// Sources prises en compte, par ordre de priorité :
// 1) Variables d'environnement (_maxPlayers, _AUTOMAXPLAYERS, AUTOMAXPLAYERS, AUTO_MAX_PLAYERS)
// 2) Dart-define (compat: _maxPlayers / AUTO_MAX_PLAYERS)
// Valeur par défaut: 4
final bool _autoJoin = (() {
  if (!kIsWeb) {
    final cliFlag = _cliFlag(
      Platform.executableArguments,
      '--autoJoin',
      aliases: const ['--auto-join'],
      negations: const ['--no-autoJoin', '--no-auto-join'],
    );
    if (cliFlag != null) return cliFlag;
  }
  final fromEnv = _tryReadEnvFlag(const [
    '_autoJoin',
    '_AUTOJOIN',
    'AUTOJOIN',
    'AUTO_JOIN',
  ]);
  if (fromEnv != null) {
    return fromEnv;
  }
  const byKey = bool.fromEnvironment('_autoJoin', defaultValue: false);
  const legacy = bool.fromEnvironment('AUTO_JOIN', defaultValue: false);
  return byKey || legacy;
})();
final int _autoMaxPlayers = (() {
  int parseInt(dynamic v) {
    try {
      if (v == null) return -1;
      final s = v.toString().trim();
      if (s.isEmpty) return -1;
      return int.parse(s);
    } catch (_) {
      return -1;
    }
  }

  if (!kIsWeb) {
    final cliValue = _cliArgumentValue(
      Platform.executableArguments,
      '--autoMaxPlayers',
      '--auto-max-players',
    );
    final cliParsed = parseInt(cliValue);
    if (cliParsed > 0) return cliParsed;
  }
  try {
    if (!kIsWeb) {
      final env = Platform.environment;
      final raw = env['_maxPlayers'] ??
          env['_AUTOMAXPLAYERS'] ??
          env['AUTOMAXPLAYERS'] ??
          env['AUTO_MAX_PLAYERS'];
      final n = parseInt(raw);
      if (n > 0) return n;
    }
  } catch (_) {}
  const byKey = int.fromEnvironment('_maxPlayers', defaultValue: 4);
  const legacy = int.fromEnvironment('AUTO_MAX_PLAYERS', defaultValue: 4);
  final n = byKey != 4 ? byKey : legacy;
  return n > 0 ? n : 4;
})();

const String _primaryServerUrl = 'http://Satigny.giize.com:3000';
const String _fallbackServerUrl = 'http://127.0.0.1:3000';
const String _connectivityPath = '/connectivity';
const Duration _probeTimeout = Duration(seconds: 2);
const Duration _autoConnectInterval = Duration(seconds: 5);

// Écran initial permettant de se connecter au serveur et de créer ou rejoindre une partie.

class ConnectScreen extends ConsumerStatefulWidget {
  const ConnectScreen({super.key});
  @override
  ConsumerState<ConsumerStatefulWidget> createState() => _ConnectScreenState();
}

class _ConnectScreenState extends ConsumerState<ConnectScreen> {
  final _nick = TextEditingController(text: _paramNick);
  static bool _autoFlowHandled =
      false; // évite de relancer la logique auto (create/join) après usage initial
  Timer? _autoConnectTimer;
  bool _autoConnectInFlight = false;

  @override
  void initState() {
    super.initState();
    _loadLastNick().then((_) async {
      await _runAutoFlowIfNeeded();
      _startAutoConnectLoop();
      await _onAutoConnectTick();
    });
  }

  @override
  void dispose() {
    _autoConnectTimer?.cancel();
    _nick.dispose();
    super.dispose();
  }

  void _startAutoConnectLoop() {
    _autoConnectTimer?.cancel();
    _autoConnectTimer = Timer.periodic(
      _autoConnectInterval,
      (_) => unawaited(_onAutoConnectTick()),
    );
  }

  Future<void> _onAutoConnectTick() async {
    if (!mounted) return;
    if (_autoConnectInFlight) return;
    final snapshot = ref.read(gameProvider);
    if (snapshot.socketConnected) {
      return;
    }
    _autoConnectInFlight = true;
    try {
      await _connectPreferredServer(waitForHandshake: true);
    } catch (err, stack) {
      AppLogger.log(
        '[auto-connect] tentative échouée: $err',
        name: 'ConnectScreen',
        error: err,
        stackTrace: stack,
      );
    } finally {
      _autoConnectInFlight = false;
    }
  }

  Future<void> _connectPreferredServer({bool waitForHandshake = false}) async {
    final wait = waitForHandshake ? const Duration(seconds: 8) : Duration.zero;

    Future<bool> connectTo(String socketUrl, String displayUrl) async {
      if (_isConnectedTo(socketUrl)) {
        return true;
      }
      return _attemptConnection(socketUrl, wait, displayUrl);
    }

    var primaryReachable = true;
    if (!kIsWeb) {
      try {
        primaryReachable =
            await _probeConnectivity(Uri.parse(_primaryServerUrl));
      } catch (_) {
        primaryReachable = false;
      }
    }

    if (primaryReachable) {
      final connected = await connectTo(_primaryServerUrl, _primaryServerUrl);
      if (connected || !waitForHandshake) {
        return;
      }
      AppLogger.log(
        '[connect] handshake Satigny échoué, essai localhost',
        name: 'ConnectScreen',
      );
    } else {
      AppLogger.log(
        '[connect] healthcheck Satigny KO, essai localhost',
        name: 'ConnectScreen',
      );
    }

    if (_primaryServerUrl == _fallbackServerUrl) {
      return;
    }

    await connectTo(_fallbackServerUrl, _fallbackServerUrl);
  }

  Future<bool> _attemptConnection(
      String socketUrl, Duration waitFor, String displayUrl) async {
    if (_isConnectedTo(socketUrl)) {
      return true;
    }
    await ref
        .read(gameProvider.notifier)
        .connect(socketUrl, displayUrl: displayUrl);
    if (waitFor <= Duration.zero) {
      return _isConnectedTo(socketUrl);
    }
    final connected = await _waitForHandshake(socketUrl, waitFor);
    return connected;
  }

  bool _isConnectedTo(String socketUrl) {
    final snapshot = ref.read(gameProvider);
    return snapshot.socketConnected && snapshot.socketUrl == socketUrl;
  }

  Future<bool> _waitForHandshake(String socketUrl, Duration timeout) async {
    final sw = Stopwatch()..start();
    while (sw.elapsed < timeout) {
      if (_isConnectedTo(socketUrl)) {
        return true;
      }
      await Future.delayed(const Duration(milliseconds: 100));
    }
    return _isConnectedTo(socketUrl);
  }

  Future<bool> _probeConnectivity(Uri base) async {
    if (kIsWeb) {
      return false;
    }
    final client = HttpClient();
    client.connectionTimeout = _probeTimeout;
    try {
      final target = base.replace(path: _connectivityPath, query: '');
      final request = await client.getUrl(target).timeout(_probeTimeout);
      final response = await request.close().timeout(_probeTimeout);
      await response.drain();
      return response.statusCode >= 200 && response.statusCode < 300;
    } catch (_) {
      return false;
    } finally {
      client.close(force: true);
    }
  }

  Future<void> _runAutoFlowIfNeeded() async {
    if ((!_autoCreate && !_autoJoin) || _autoFlowHandled) {
      return;
    }
    _autoFlowHandled = true;
    final ctl = ref.read(gameProvider.notifier);

    if (_nick.text.trim().isEmpty) {
      final rnd = Random();
      _nick.text = 'Player${1000 + rnd.nextInt(9000)}';
    }

    await _connectPreferredServer(waitForHandshake: true);
    await _saveNick();

    final joined = await _attemptAutoJoin(ctl);
    if (joined) {
      return;
    }

    if (_autoCreate) {
      final err = await ctl.createGame(_nick.text.trim(), _autoMaxPlayers);
      if (err != null) {
        AppLogger.log('[auto] createGame failed: $err', name: 'ConnectScreen');
      }
    }
  }

  Future<bool> _attemptAutoJoin(GameController ctl) async {
    const maxChecks = 50; // ~5s
    for (var i = 0; i < maxChecks; i++) {
      final snapshot = ref.read(gameProvider);
      if (snapshot.gameId != null) {
        return true;
      }
      if (snapshot.lobby.isNotEmpty) {
        final games = snapshot.lobby;
        final withSlots = games.where((g) => g.slots > 0).toList();
        final target = (withSlots.isNotEmpty ? withSlots : games).first;
        final err = await ctl.joinGame(target.id, _nick.text.trim());
        if (err != null) {
          AppLogger.log('[auto] joinGame failed: $err', name: 'ConnectScreen');
          return false;
        }
        return true;
      }
      await Future.delayed(const Duration(milliseconds: 100));
    }
    final finalState = ref.read(gameProvider);
    return finalState.gameId != null;
  }

  Future<void> _loadLastNick() async {
    final prefs = await SharedPreferences.getInstance();
    if (_nick.text.isEmpty) {
      _nick.text = prefs.getString('nick') ?? '';
    }
  }

  Future<void> _saveNick() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('nick', _nick.text.trim());
  }

  @override
  Widget build(BuildContext context) {
    final gm = ref.watch(gameProvider);
    final ctl = ref.read(gameProvider.notifier);

    return Scaffold(
      appBar: AppBar(title: const Text('Connexion & Lobby')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          TextField(
            controller: _nick,
            decoration: const InputDecoration(labelText: 'Pseudonyme'),
            onChanged: (_) => _saveNick(),
          ),
          const SizedBox(height: 8),
          LayoutBuilder(
            builder: (context, constraints) {
              final buttons = <Widget>[
                ElevatedButton(
                  onPressed: (gm.socketConnected && gm.gameId == null)
                      ? () async {
                          await _saveNick();
                          if (!context.mounted) return;
                          await Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (_) => GameOptionsScreen(
                                  nickname: _nick.text.trim()),
                            ),
                          );
                        }
                      : null,
                  child: const Text('Créer partie'),
                ),
              ];
              // Ne pas proposer d'annulation ici : une fois qu'une partie est
              // créée/jointe (phase LOBBY), le routeur principal bascule vers
              // l'écran "Salle d'attente" (WaitingLobby) qui contient déjà le
              // bouton approprié (annuler/quitter). Garder ce bouton ici crée
              // une redondance et peut embrouiller l'utilisateur.
              if (constraints.maxWidth < 360) {
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    for (var i = 0; i < buttons.length; i++) ...[
                      buttons[i],
                      if (i != buttons.length - 1) const SizedBox(height: 8),
                    ],
                  ],
                );
              }
              return Wrap(
                spacing: 8,
                runSpacing: 8,
                children: buttons,
              );
            },
          ),
          const SizedBox(height: 16),
          const Divider(),
          const Text('Parties en attente',
              style: TextStyle(fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          Expanded(
            child: ListView.builder(
              itemCount: gm.lobby.length,
              itemBuilder: (context, i) {
                final g = gm.lobby[i];
                return ListTile(
                  title: Text(g.id),
                  subtitle: Text(
                      'Joueurs ${g.players}/${g.maxPlayers} • places ${g.slots}'),
                  onTap: gm.socketConnected
                      ? () async {
                          await _saveNick();
                          final err =
                              await ctl.joinGame(g.id, _nick.text.trim());
                          if (err != null && context.mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                              backgroundColor: Colors.red,
                              content: Text(err),
                            ));
                          }
                        }
                      : null,
                );
              },
            ),
          ),
        ]),
      ),
    );
  }
}

