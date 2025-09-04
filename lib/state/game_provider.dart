import 'dart:developer';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../services/socket_service.dart';
import 'models.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

final gameProvider = StateNotifierProvider<GameController, GameModel>((ref) => GameController());

class GameController extends StateNotifier<GameModel> {
  GameController() : super(GameModel.initial()) {
    _init();
  }

  final _socketSvc = SocketService();
  final Future<SharedPreferences> _prefs = SharedPreferences.getInstance();

  Future<void> _init() async {
    final prefs = await _prefs;
    final url = prefs.getString('serverUrl');
    final gid = prefs.getString('gameId');
    final pid = prefs.getString('playerId');
    final phaseStr = prefs.getString('phase');
    final roleStr = prefs.getString('role');
    final vib = prefs.getBool('vibrations');
    GamePhase phase = state.phase;
    if (phaseStr != null) {
      try {
        phase = phaseFromStr(phaseStr);
      } catch (_) {}
    }
    Role? role;
    if (roleStr != null) {
      try {
        role = roleFromStr(roleStr);
      } catch (_) {}
    }
    state = state.copy(
      serverUrl: url ?? state.serverUrl,
      gameId: gid,
      playerId: pid,
      phase: phase,
      role: role,
      vibrations: vib ?? state.vibrations,
    );
    if (url != null) {
      await connect(url);
    }
  }

  Future<void> _persist() async {
    final prefs = await _prefs;
    await prefs.setString('serverUrl', state.serverUrl);
    await prefs.setBool('vibrations', state.vibrations);
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
    await prefs.setString('phase', describeEnum(state.phase));
    if (state.role != null) {
      await prefs.setString('role', describeEnum(state.role!));
    } else {
      await prefs.remove('role');
    }
  }

  Future<void> _clearSession() async {
    final prefs = await _prefs;
    await prefs.remove('gameId');
    await prefs.remove('playerId');
    await prefs.remove('phase');
    await prefs.remove('role');
  }

  // ------------- Socket lifecycle -------------
  Future<void> connect(String url) async {
    final io.Socket s = _socketSvc.connect(url);
    state = state.copy(serverUrl: url, socketConnected: false);
    await _persist();

    s.on('connect', (_) async {
      state = state.copy(socketConnected: true);
      await _persist();
      log('[event] connect');
      // If we have a session, resume
      if (state.gameId != null && state.playerId != null) {
        final ack = await _socketSvc.emitAck('session:resume', {
          'gameId': state.gameId,
          'playerId': state.playerId,
        });
        log('[ack] session:resume $ack');
        await _setContext();
      }
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
      _persist();
      log('[evt] role:assigned $role');
    });

    s.on('game:stateChanged', (data) {
      final phase = phaseFromStr(data['state']);
      final deadline = data['deadline'] as int?;
      state = state.copy(phase: phase, deadlineMs: deadline);
      _persist();
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
      state = state.copy(phase: phase, players: players, role: role, deadlineMs: deadline);
      _persist();
      log('[evt] game:snapshot role=$role phase=$phase players=${players.length}');
    });

    s.on('game:ended', (data) {
      final win = data['winner'] as String?;
      state = state.copy(winner: win, phase: GamePhase.END);
      _persist();
      log('[evt] game:ended winner=$win');
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

    // --- Morning
    s.on('day:recap', (data) async {
      final deaths = ((data['deaths'] as List?) ?? [])
          .map((e) => Map<String, dynamic>.from(e))
          .map<(String, String)>((j) => (j['playerId'] as String, j['role'] as String))
          .toList();
      final recap = DayRecap(deaths: deaths);
      final deadIds = deaths.map((d) => d.$1).toSet();
      final updatedPlayers = state.players
          .map((p) => deadIds.contains(p.id)
              ? PlayerView(id: p.id, connected: p.connected, alive: false)
              : p)
          .toList();
      state = state.copy(recap: recap, players: updatedPlayers);
      if (state.vibrations) await HapticFeedback.vibrate();
      log('[evt] day:recap deaths=${deaths.length}');
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
      players: [], // filled by snapshot/state changes
    );
    await _setContext();
    await _persist();
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
    );
    await _setContext();
    await _persist();
    return null;
  }

  Future<void> refreshLobby() => _listGames();

  Future<void> toggleVibrations(bool on) async {
    state = state.copy(vibrations: on);
    await _persist();
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
    final url = state.serverUrl;
    final vib = state.vibrations;
    state = GameModel.initial().copy(serverUrl: url, vibrations: vib);
    await _clearSession();
    await _persist();
  }
}
