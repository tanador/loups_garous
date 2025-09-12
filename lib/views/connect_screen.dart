import 'dart:io';
import 'dart:math';
import 'package:flutter/foundation.dart' show kIsWeb;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../state/game_provider.dart';
import '../state/models.dart';
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
      final v = (env['_paramNick'] ?? env['_PARAMNICK'] ?? env['PARAMNICK'] ?? env['PSEUDO'] ?? '').trim();
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
      final raw = env['_autoCreate'] ?? env['_AUTOCREATE'] ?? env['AUTOCREATE'] ?? env['AUTO_CREATE'];
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
    } catch (_) { return -1; }
  }
  try {
    if (!kIsWeb) {
      final env = Platform.environment;
      final raw = env['_maxPlayers'] ?? env['_AUTOMAXPLAYERS'] ?? env['AUTOMAXPLAYERS'] ?? env['AUTO_MAX_PLAYERS'];
      final n = parseInt(raw);
      if (n > 0) return n;
    }
  } catch (_) {}
  const byKey = int.fromEnvironment('_maxPlayers', defaultValue: 4);
  const legacy = int.fromEnvironment('AUTO_MAX_PLAYERS', defaultValue: 4);
  final n = byKey != 4 ? byKey : legacy;
  return n > 0 ? n : 4;
})();



// Écran initial permettant de se connecter au serveur et de créer ou rejoindre une partie.

class ConnectScreen extends ConsumerStatefulWidget {
  const ConnectScreen({super.key});
  @override
  ConsumerState<ConsumerStatefulWidget> createState() => _ConnectScreenState();
}

class _ConnectScreenState extends ConsumerState<ConnectScreen> {
  late final TextEditingController _url;
  final _nick = TextEditingController(text: _paramNick);
  static bool _autoRan = false; // évite de relancer autoCreate après un retour au ConnectScreen
  static bool _autoClientRan = false; // évite de relancer l'auto connexion/join via PSEUDO

  @override
  void initState() {
    super.initState();
    _url = TextEditingController(text: Platform.isAndroid ? 'http://10.0.2.2:3000' : 'http://localhost:3000');
    _loadLastNick().then((_) {
      if (_autoCreate) {
        _autoStart();
      }
      // Si un pseudonyme est fourni (_paramNick),
      // on simule un clic sur "Se connecter" puis on rejoint automatiquement
      // une partie en attente s'il y en a au lobby.
      if (_paramNick.isNotEmpty) {
        _autoConnectAndJoinIfPossible();
      }
    });
  }

  @override
  void dispose() {
    _url.dispose();
    _nick.dispose();
    super.dispose();
  }

  Future<void> _autoConnectAndJoinIfPossible() async {
    if (_autoClientRan) return;
    final ctl = ref.read(gameProvider.notifier);
    // Assure une connexion socket comme si on avait cliqué sur "Se connecter"
    if (!ref.read(gameProvider).socketConnected) {
      await ctl.connect(_url.text);
      for (int i = 0; i < 100; i++) { // ~10s max
        await Future.delayed(const Duration(milliseconds: 100));
        if (ref.read(gameProvider).socketConnected) break;
      }
    }
    await _saveNick();
    // Rafraîchit et attend la liste de parties du lobby
    await ctl.refreshLobby();
    for (int i = 0; i < 50; i++) { // ~5s max
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
    if (!ref.read(gameProvider).socketConnected) {
      await ctl.connect(_url.text);
      for (int i = 0; i < 100; i++) { // ~10s max
        await Future.delayed(const Duration(milliseconds: 100));
        if (ref.read(gameProvider).socketConnected) break;
      }
    }

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
          TextField(controller: _url, decoration: const InputDecoration(labelText: 'URL serveur (http://IP:3000)')),
          const SizedBox(height: 8),
          TextField(
            controller: _nick,
            decoration: const InputDecoration(labelText: 'Pseudonyme'),
            onChanged: (_) => _saveNick(),
          ),
          const SizedBox(height: 8),
          Row(children: [
            ElevatedButton(
              onPressed: () => ctl.connect(_url.text),
              child: Text(gm.socketConnected ? 'Reconnecté' : 'Se connecter'),
            ),
            const SizedBox(width: 8),
            ElevatedButton(
              onPressed: gm.socketConnected
                  ? () async {
                      await _saveNick();
                      if (!context.mounted) return;
                      await Navigator.of(context).push(MaterialPageRoute(
                          builder: (_) => GameOptionsScreen(nickname: _nick.text.trim())));
                    }
                  : null,
              child: const Text('Créer partie'),
            ),
            const SizedBox(width: 8),
            ElevatedButton(
              onPressed: gm.socketConnected ? () => ctl.refreshLobby() : null,
              child: const Text('Actualiser'),
            ),
            if (gm.gameId != null && gm.phase == GamePhase.LOBBY) ...[
              const SizedBox(width: 8),
              ElevatedButton(
                onPressed: () async {
                  final err = await ctl.cancelGame();
                  if (err != null && context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(backgroundColor: Colors.red, content: Text(err)),
                    );
                  }
                },
                child: const Text('Annuler ma partie'),
              ),
            ],
          ]),
          const SizedBox(height: 16),
          Row(
            children: [
              Switch(
                value: gm.vibrations,
                onChanged: (v) => ctl.toggleVibrations(v),
              ),
              const Text('Vibrations'),
            ],
          ),
          const Divider(),
          const Text('Parties en attente', style: TextStyle(fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          Expanded(
            child: ListView.builder(
              itemCount: gm.lobby.length,
              itemBuilder: (context, i) {
                final g = gm.lobby[i];
                return ListTile(
                  title: Text(g.id),
                  subtitle: Text('Joueurs ${g.players}/${g.maxPlayers} • places ${g.slots}'),
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
