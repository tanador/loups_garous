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

// Paramètres de lancement (lecture à l'exécution)
// _paramNick     -> force le pseudo par défaut
// _autoCreate    -> si "true" (ou 1/yes/y), crée automatiquement une partie (4 joueurs)
//
// Sources prises en compte, par ordre de priorité :
// 1) Variables d'environnement (ex: _paramNick, _autoCreate)
// 2) Dart-define (compat: PSEUDO / AUTO_CREATE)
final String _paramNick = (() {
  try {
    if (!kIsWeb) {
      final env = Platform.environment;
      final v = (env['_paramNick'] ??
              env['_PARAMNICK'] ??
              env['PARAMNICK'] ??
              env['PSEUDO'] ??
              '')
          .trim();
      if (v.isNotEmpty) return v;
    }
  } catch (_) {}
  const byKey = String.fromEnvironment('_paramNick', defaultValue: '');
  if (byKey.isNotEmpty) return byKey;
  const legacy = String.fromEnvironment('PSEUDO', defaultValue: '');
  return legacy;
})();

final bool _autoCreate = (() {
  try {
    if (!kIsWeb) {
      final env = Platform.environment;
      final raw = env['_autoCreate'] ??
          env['_AUTOCREATE'] ??
          env['AUTOCREATE'] ??
          env['AUTO_CREATE'];
      if (raw != null) {
        final s = raw.toLowerCase();
        if (s == '1' || s == 'true' || s == 'yes' || s == 'y') return true;
      }
    }
  } catch (_) {}
  const byKey = bool.fromEnvironment('_autoCreate', defaultValue: false);
  const legacy = bool.fromEnvironment('AUTO_CREATE', defaultValue: false);
  return byKey || legacy;
})();

// Nombre de joueurs pour l'auto-création (si _autoCreate est activé).
// Sources prises en compte, par ordre de priorité :
// 1) Variables d'environnement (_maxPlayers, _AUTOMAXPLAYERS, AUTOMAXPLAYERS, AUTO_MAX_PLAYERS)
// 2) Dart-define (compat: _maxPlayers / AUTO_MAX_PLAYERS)
// Valeur par défaut: 4
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
  static bool _autoRan =
      false; // évite de relancer autoCreate après un retour au ConnectScreen
  static bool _autoClientRan =
      false; // évite de relancer l'auto connexion/join via PSEUDO
  Timer? _autoConnectTimer;
  bool _autoConnectInFlight = false;

  @override
  void initState() {
    super.initState();
    _loadLastNick().then((_) async {
      if (_autoCreate) {
        await _autoStart();
      }
      // Si un pseudonyme est fourni (_paramNick),
      // on lance immédiatement la connexion automatique puis on rejoint
      // une partie en attente s'il y en a au lobby.
      if (_paramNick.isNotEmpty) {
        await _autoConnectAndJoinIfPossible();
      }
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

  Future<void> _autoConnectAndJoinIfPossible() async {
    if (_autoClientRan) return;
    final ctl = ref.read(gameProvider.notifier);
    // Assure une tentative de connexion automatique sur les serveurs connus
    await _connectPreferredServer(waitForHandshake: true);
    await _saveNick();
    // Attend que le serveur pousse la liste du lobby
    for (int i = 0; i < 50; i++) {
      // ~5s max
      await Future.delayed(const Duration(milliseconds: 100));
      final lobby = ref.read(gameProvider).lobby;
      if (lobby.isNotEmpty) break;
    }
    final s = ref.read(gameProvider);
    if (s.gameId == null && s.lobby.isNotEmpty) {
      // Prend une partie qui a des places disponibles si possible, sinon la première.
      final games = s.lobby;
      final withSlots = games.where((g) => g.slots > 0).toList();
      final target = (withSlots.isNotEmpty ? withSlots : games).first;
      await ctl.joinGame(target.id, _nick.text.trim());
    }
    _autoClientRan = true;
  }

  Future<void> _loadLastNick() async {
    final prefs = await SharedPreferences.getInstance();
    if (_nick.text.isEmpty) {
      _nick.text = prefs.getString('nick') ?? '';
    }
  }

  Future<void> _autoStart() async {
    if (_autoRan) return; // déjà exécuté pendant cette session
    final ctl = ref.read(gameProvider.notifier);
    // Ensure nickname (fallback if none provided via PSEUDO or prefs)
    if (_nick.text.trim().isEmpty) {
      final rnd = Random();
      _nick.text = 'Player${1000 + rnd.nextInt(9000)}';
    }

    // Connect if needed and wait until the socket handshake completes
    await _connectPreferredServer(waitForHandshake: true);

    await _saveNick();
    await ctl.createGame(_nick.text.trim(), _autoMaxPlayers);
    _autoRan = true; // marque l'auto démarrage comme effectué
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
                  onPressed: gm.socketConnected
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
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(
                                  backgroundColor: Colors.red,
                                  content: Text(err)),
                            );
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
