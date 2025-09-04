import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../state/game_provider.dart';
import '../state/models.dart';

class ConnectScreen extends ConsumerStatefulWidget {
  const ConnectScreen({super.key});
  @override
  ConsumerState<ConsumerStatefulWidget> createState() => _ConnectScreenState();
}

class _ConnectScreenState extends ConsumerState<ConnectScreen> {
  late final TextEditingController _url;
  final _nick = TextEditingController();
  int _maxPlayers = 3;

  @override
  void initState() {
    super.initState();
    _url = TextEditingController(text: Platform.isAndroid ? 'http://10.0.2.2:3000' : 'http://localhost:3000');
    _loadLastNick();
  }

  @override
  void dispose() {
    _url.dispose();
    _nick.dispose();
    super.dispose();
  }

  Future<void> _loadLastNick() async {
    final prefs = await SharedPreferences.getInstance();
    _nick.text = prefs.getString('nick') ?? '';
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
          Row(children: [
            Expanded(
                child: TextField(
              controller: _nick,
              decoration: const InputDecoration(labelText: 'Pseudonyme'),
              onChanged: (_) => _saveNick(),
            )),
            const SizedBox(width: 8),
            DropdownButton<int>(
              value: _maxPlayers,
              items: const [
                DropdownMenuItem(value: 3, child: Text('3 joueurs')),
                DropdownMenuItem(value: 4, child: Text('4 joueurs')),
              ],
              onChanged: (v) => setState(() => _maxPlayers = v ?? 3),
            ),
          ]),
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
                      final err = await ctl.createGame(_nick.text.trim(), _maxPlayers);
                      if (err != null && context.mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(backgroundColor: Colors.red, content: Text(err)),
                        );
                      }
                    }
                  : null,
              child: const Text('Créer partie'),
            ),
            const SizedBox(width: 8),
            ElevatedButton(
              onPressed: gm.socketConnected ? () => ctl.refreshLobby() : null,
              child: const Text('Actualiser'),
            ),
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
