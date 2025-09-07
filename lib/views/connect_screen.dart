import 'dart:io';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../state/game_provider.dart';
import '../state/models.dart';
import 'game_options_screen.dart';

// Optional compile-time parameters.
// Pass values using `--dart-define=PSEUDO=foo` and
// `--dart-define=AUTO_CREATE=true` when launching the app.
const _paramNick = String.fromEnvironment('PSEUDO', defaultValue: '');
const _autoCreate = bool.fromEnvironment('AUTO_CREATE', defaultValue: false);

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

  @override
  void initState() {
    super.initState();
    _url = TextEditingController(text: Platform.isAndroid ? 'http://10.0.2.2:3000' : 'http://localhost:3000');
    _loadLastNick().then((_) {
      if (_autoCreate) {
        _autoStart();
      }
    });
  }

  @override
  void dispose() {
    _url.dispose();
    _nick.dispose();
    super.dispose();
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
    await ctl.createGame(_nick.text.trim(), 4);
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
