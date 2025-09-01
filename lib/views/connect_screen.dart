import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
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
  String _variant = 'AUTO';
  String? _selectedGame;

  @override
  void initState() {
    super.initState();
    _url = TextEditingController(text: Platform.isAndroid ? 'http://10.0.2.2:3000' : 'http://localhost:3000');
  }

  @override
  void dispose() {
    _url.dispose();
    _nick.dispose();
    super.dispose();
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
            Expanded(child: TextField(controller: _nick, decoration: const InputDecoration(labelText: 'Pseudonyme'))),
            const SizedBox(width: 8),
            DropdownButton<String>(
              value: _variant,
              items: const [
                DropdownMenuItem(value: 'AUTO', child: Text('AUTO')),
                DropdownMenuItem(value: 'V1', child: Text('V1: 2 Loups + 1 Sorcière')),
                DropdownMenuItem(value: 'V2', child: Text('V2: Loup + Sorcière + Villageois')),
              ],
              onChanged: (v) => setState(() => _variant = v ?? 'AUTO'),
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
                      final err = await ctl.createGame(_nick.text.trim(), _variant);
                      if (err != null && context.mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err)));
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
                final selected = _selectedGame == g.id;
                return ListTile(
                  title: Text('${g.id} • ${g.variant}'),
                  subtitle: Text('Joueurs ${g.players}/3 • places ${g.slots}'),
                  trailing: selected ? const Icon(Icons.check_circle) : null,
                  onTap: () => setState(() => _selectedGame = g.id),
                );
              },
            ),
          ),
          Row(children: [
            Expanded(
              child: ElevatedButton(
                onPressed: gm.socketConnected && _selectedGame != null
                    ? () async {
                        final err = await ctl.joinGame(_selectedGame!, _nick.text.trim());
                        if (err != null && context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err)));
                        }
                      }
                    : null,
                child: const Text('Rejoindre la partie sélectionnée'),
              ),
            ),
          ])
        ]),
      ),
    );
  }
}
