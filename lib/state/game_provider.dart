import 'dart:developer';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../services/socket_service.dart';
import 'models.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

final gameProvider =
    StateNotifierProvider<GameController, GameModel>((ref) => GameController());

/// Contrôleur principal de l'application.
/// Il maintient l'état du jeu dans [GameModel] et gère
/// la communication avec le serveur via Socket.IO.
class GameController extends StateNotifier<GameModel> {
  GameController() : super(GameModel.initial()) {
    _restoreSession();
  }

  final _socketSvc = SocketService();

  /// Tente de restaurer une session précédente depuis le stockage local.
  /// Si une partie était en cours, on reconnecte automatiquement au serveur.
  Future<void> _restoreSession() async {
    final prefs = await SharedPreferences.getInstance();
    final url = prefs.getString('serverUrl');
    final gameId = prefs.getString('gameId');
    final playerId = prefs.getString('playerId');
    if (url != null) {
      state = state.copy(serverUrl: url, gameId: gameId, playerId: playerId);
      if (gameId != null && playerId != null) {
        connect(url);
      }
    }
  }

  /// Sauvegarde la session courante afin de pouvoir la restaurer au prochain démarrage.
  Future<void> _saveSession() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('serverUrl', state.serverUrl);
    if (state.gameId != null) {
      await prefs.setString('gameId', state.gameId!);
    } else {
      await prefs.remove('gameId');
    }
    if (state.playerId != null) {
      await prefs.setString('playerId', state.playerId!);
    } else {
      await prefs.remove('playerId');
    }
  }

  /// Efface toute information liée à la session persistée.
  Future<void> _clearSession() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('gameId');
    await prefs.remove('playerId');
  }

  /// Réinitialise complètement l'état du jeu côté client.
  void _resetGameState() {
    state = state.copy(
      gameId: null,
      playerId: null,
      role: null,
      phase: GamePhase.LOBBY,
      round: 0,
      players: [],
      deadlineMs: null,
      maxPlayers: 3,
      wolvesTargets: [],
      wolvesLockedTargetId: null,
      confirmationsRemaining: 0,
      witchWake: null,
      hunterTargets: [],
      recap: null,
      voteAlive: [],
      lastVote: null,
      winner: null,
      finalRoles: [],
    );
  }

  // ------------- Cycle de vie du socket -------------
  /// Ouvre une connexion Socket.IO et enregistre tous les listeners nécessaires.
  /// Cette méthode prépare également la reprise d'une session existante si possible.
  Future<void> connect(String url) async {
    final io.Socket s = _socketSvc.connect(url);
    state = state.copy(serverUrl: url, socketConnected: false);
    await _saveSession();

    s.on('connect', (_) async {
      state = state.copy(socketConnected: true);
      log('[event] connect');
      // Si nous avions déjà rejoint une partie, tentons de reprendre la session.
      if (state.gameId != null && state.playerId != null) {
        final ack = await _socketSvc.emitAck('session:resume', {
          'gameId': state.gameId,
          'playerId': state.playerId,
        });
        log('[ack] session:resume $ack');
        await _setContext();
      }
      // Récupère la liste des parties disponibles dans le lobby.
      _listGames();
    });

    s.on('disconnect', (_) {
      state = state.copy(socketConnected: false);
      log('[event] disconnect');
    });

    // --- Lobby events
    s.on('lobby:updated', (data) {
      final games = (data?['games'] as List?)
              ?.map((e) => LobbyGameInfo.fromJson(Map<String, dynamic>.from(e)))
              .toList() ??
          [];
      state = state.copy(lobby: games);
      log('[evt] lobby:updated ${games.length}');
    });

    // --- Role and state
    s.on('role:assigned', (data) {
      final role = roleFromStr(data['role']);
      state = state.copy(role: role, phase: GamePhase.ROLES);
      log('[evt] role:assigned $role');
    });

    s.on('game:stateChanged', (data) {
      final phase = phaseFromStr(data['state']);
      final deadline = data['deadline'] as int?;
      state = state.copy(phase: phase, deadlineMs: deadline);
      log('[evt] game:stateChanged $phase deadline=$deadline');
    });

    s.on('game:snapshot', (data) {
      // sync full snapshot
      final players = ((data['players'] as List?) ?? [])
          .map((e) => Map<String, dynamic>.from(e))
          .map((j) => PlayerView(
                id: j['id'],
                connected: j['connected'] == true,
                alive: j['alive'] == true,
              ))
          .toList();
      final role = roleFromStr(data['you']['role']);
      final phase = phaseFromStr(data['state']);
      final deadline = data['deadline'] as int?;
      final maxPlayers = (data['maxPlayers'] as int?) ?? state.maxPlayers;
      state = state.copy(phase: phase, players: players, role: role, deadlineMs: deadline, maxPlayers: maxPlayers);
      log('[evt] game:snapshot role=$role phase=$phase players=${players.length}');
    });

    s.on('game:ended', (data) {
      final win = data['winner'] as String?;
      final roles = ((data['roles'] as List?) ?? [])
          .map((e) => Map<String, dynamic>.from(e))
          .map<(String, Role)>((j) => (
                j['playerId'] as String,
                roleFromStr(j['role'] as String),
              ))
          .toList();
      state = state.copy(winner: win, phase: GamePhase.END, finalRoles: roles);
      log('[evt] game:ended winner=$win roles=${roles.length}');
    });

    s.on('game:cancelled', (_) async {
      _resetGameState();
      await _clearSession();
      log('[evt] game:cancelled');
    });

    // --- Night: wolves
    s.on('wolves:wake', (data) async {
      final list = ((data['alive'] as List?) ?? [])
          .map((e) => Map<String, dynamic>.from(e))
          .map((j) => Lite(id: j['id']))
          .toList();
      state = state.copy(wolvesTargets: list, wolvesLockedTargetId: null, confirmationsRemaining: 0);
      if (state.vibrations) await HapticFeedback.vibrate();
      log('[evt] wolves:wake targets=${list.length}');
    });

    s.on('wolves:targetLocked', (data) {
      state = state.copy(
        wolvesLockedTargetId: data['targetId'] as String?,
        confirmationsRemaining: (data['confirmationsRemaining'] ?? 0) as int,
      );
      log('[evt] wolves:targetLocked ${state.wolvesLockedTargetId} confLeft=${state.confirmationsRemaining}');
    });

    // --- Night: witch
    s.on('witch:wake', (data) async {
      final alive = ((data['alive'] as List?) ?? [])
          .map((e) => Map<String, dynamic>.from(e))
          .map((j) => Lite(id: j['id']))
          .toList();
      final ww = WitchWake(
        attacked: data['attacked'] as String?,
        healAvailable: data['healAvailable'] == true,
        poisonAvailable: data['poisonAvailable'] == true,
        alive: alive,
      );
      state = state.copy(witchWake: ww);
      if (state.vibrations) await HapticFeedback.vibrate();
      log('[evt] witch:wake attacked=${ww.attacked} heal=${ww.healAvailable} poison=${ww.poisonAvailable}');
    });

    // --- Hunter ability
    s.on('hunter:wake', (data) async {
      final alive = ((data['alive'] as List?) ?? [])
          .map((e) => Map<String, dynamic>.from(e))
          .map((j) => Lite(id: j['id']))
          .toList();
      state = state.copy(hunterTargets: alive);
      if (state.vibrations) await HapticFeedback.vibrate();
      log('[evt] hunter:wake targets=${alive.length}');
    });

    // --- Morning
    s.on('day:recap', (data) async {
      final deaths = ((data['deaths'] as List?) ?? [])
          .map((e) => Map<String, dynamic>.from(e))
          .map<(String, String)>((j) => (j['playerId'] as String, j['role'] as String))
          .toList();
      final hunterKills = ((data['hunterKills'] as List?) ?? [])
          .map((e) => Map<String, dynamic>.from(e))
          .map<String>((j) => j['targetId'] as String)
          .toList();
      final recap = DayRecap(deaths: deaths, hunterKills: hunterKills);
      final deadIds = deaths.map((d) => d.$1).toSet();
      final updatedPlayers = state.players
          .map((p) => deadIds.contains(p.id)
              ? PlayerView(id: p.id, connected: p.connected, alive: false)
              : p)
          .toList();
      state = state.copy(recap: recap, players: updatedPlayers, hunterTargets: []);
      if (state.vibrations) await HapticFeedback.vibrate();
      log('[evt] day:recap deaths=${deaths.length} hunterKills=${hunterKills.length}');
    });

    s.on('day:hunterKill', (data) async {
      final pid = data['targetId'] as String;
      final r = state.recap;
      if (r != null) {
        final newKills = [...r.hunterKills, pid];
        final recap = DayRecap(deaths: r.deaths, hunterKills: newKills);
        final updatedPlayers = state.players
            .map((p) => p.id == pid
                ? PlayerView(id: p.id, connected: p.connected, alive: false)
                : p)
            .toList();
        state = state.copy(recap: recap, players: updatedPlayers);
      }
      if (state.vibrations) await HapticFeedback.vibrate();
      log('[evt] day:hunterKill target=$pid');
    });

    // --- Vote
    s.on('vote:options', (data) {
      final alive = ((data['alive'] as List?) ?? [])
          .map((e) => Map<String, dynamic>.from(e))
          .map((j) => Lite(id: j['id']))
          .toList();
      state = state.copy(voteAlive: alive, lastVote: null);
      log('[evt] vote:options ${alive.length}');
    });

    s.on('vote:results', (data) {
      final tallyMap = <String, int>{};
      (data['tally'] as Map?)?.forEach((k, v) => tallyMap[k.toString()] = (v as num).toInt());
      final vr = VoteResult(
        eliminatedId: data['eliminatedId'] as String?,
        role: data['role'] as String?,
        tally: tallyMap,
      );
      final elimId = vr.eliminatedId;
      final updatedPlayers = elimId == null
          ? state.players
          : state.players
              .map((p) => p.id == elimId
                  ? PlayerView(id: p.id, connected: p.connected, alive: false)
                  : p)
              .toList();
      state = state.copy(lastVote: vr, players: updatedPlayers);
      log('[evt] vote:results eliminated=${vr.eliminatedId} role=${vr.role}');
    });

    // Initiate connection after all listeners are registered to avoid missing early events
    s.connect();
  }

  /// Demande au serveur la liste des parties dans le lobby
  /// et met à jour l'état local avec le résultat.
  Future<void> _listGames() async {
    final ack = await _socketSvc.emitAck('lobby:listGames', {});
    final games = ((ack['data']?['games'] as List?) ?? [])
        .map((e) => LobbyGameInfo.fromJson(Map<String, dynamic>.from(e)))
        .toList();
    state = state.copy(lobby: games);
  }

  // ------------- Lobby actions -------------
  Future<String?> createGame(String nickname, int maxPlayers) async {
    final ack = await _socketSvc.emitAck('lobby:create', {'nickname': nickname, 'maxPlayers': maxPlayers});
    if (ack['ok'] != true) {
      final err = ack['error']?.toString() ?? 'unknown_error';
      if (err == 'nickname_taken') return 'Ce pseudo est déjà pris';
      return err;
    }
    final data = Map<String, dynamic>.from(ack['data']);
    state = state.copy(
      gameId: data['gameId'],
      playerId: data['playerId'],
      maxPlayers: data['maxPlayers'] as int? ?? maxPlayers,
      players: [], // filled by snapshot/state changes
    );
    await _setContext();
    await _saveSession();
    return null;
  }

  Future<String?> joinGame(String gameId, String nickname) async {
    final ack = await _socketSvc.emitAck('lobby:join', {'gameId': gameId, 'nickname': nickname});
    if (ack['ok'] != true) {
      final err = ack['error']?.toString() ?? 'unknown_error';
      if (err == 'nickname_taken') return 'Ce pseudo est déjà pris';
      return err;
    }
    final data = Map<String, dynamic>.from(ack['data']);
    state = state.copy(
      gameId: data['gameId'],
      playerId: data['playerId'],
      maxPlayers: data['maxPlayers'] as int? ?? state.maxPlayers,
    );
    await _setContext();
    await _saveSession();
    return null;
  }

  Future<String?> cancelGame() async {
    String? err;
    try {
      final ack = await _socketSvc.emitAck('lobby:cancel', {
        'gameId': state.gameId,
        'playerId': state.playerId,
      });
      log('[ack] lobby:cancel $ack');
      if (ack['ok'] != true) {
        err = ack['error']?.toString() ?? 'unknown_error';
        log('cancelGame error: ' + err);
      }
    } catch (e, st) {
      err = e.toString();
      log('cancelGame exception: $err', stackTrace: st);
    }
    _resetGameState();
    await _clearSession();
    return err;
  }

  Future<String?> leaveGame() async {
    String? err;
    try {
      final ack = await _socketSvc.emitAck('lobby:leave', {
        'gameId': state.gameId,
        'playerId': state.playerId,
      });
      log('[ack] lobby:leave $ack');
      if (ack['ok'] != true) {
        err = ack['error']?.toString() ?? 'unknown_error';
        log('leaveGame error: ' + err);
      }
    } catch (e, st) {
      err = e.toString();
      log('leaveGame exception: $err', stackTrace: st);
    }
    _resetGameState();
    await _clearSession();
    return err;
  }

  Future<void> refreshLobby() => _listGames();

  Future<void> toggleVibrations(bool on) async {
    state = state.copy(vibrations: on);
  }

  // ------------- Context & ready -------------
  Future<void> _setContext() async {
    final ack = await _socketSvc.emitAck('context:set', {
      'gameId': state.gameId,
      'playerId': state.playerId,
    });
    log('[ack] context:set $ack');
  }

  Future<void> toggleReady(bool ready) async {
    final event = ready ? 'player:ready' : 'player:unready';
    final ack = await _socketSvc.emitAck(event, {});
    log('[ack] $event $ack');
  }

  // ------------- Wolves -------------
  Future<void> wolvesChoose(String targetId) async {
    final ack = await _socketSvc.emitAck('wolves:chooseTarget', {'targetId': targetId});
    log('[ack] wolves:chooseTarget $ack');
  }

  // ------------- Witch -------------
  Future<void> witchDecision({required bool save, String? poisonTargetId}) async {
    final payload = {'save': save, if (poisonTargetId != null) 'poisonTargetId': poisonTargetId};
    final ack = await _socketSvc.emitAck('witch:decision', payload);
    log('[ack] witch:decision $ack');
  }

  // ------------- Hunter -------------
  Future<void> hunterShoot(String targetId) async {
    final ack = await _socketSvc.emitAck('hunter:shoot', {'targetId': targetId});
    log('[ack] hunter:shoot $ack');
    state = state.copy(hunterTargets: []);
  }

  // ------------- Morning ack -------------
  Future<void> dayAck() async {
    final ack = await _socketSvc.emitAck('day:ack', {});
    log('[ack] day:ack $ack');
  }

  // ------------- Vote -------------
  Future<void> voteCast(String targetId) async {
    final ack = await _socketSvc.emitAck('vote:cast', {'targetId': targetId});
    log('[ack] vote:cast $ack');
  }

  // ------------- Reset -------------
  Future<void> leaveToHome() async {
    _socketSvc.dispose();
    state = GameModel.initial();
    await _clearSession();
  }
}
