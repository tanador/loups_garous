// Couche "state": gestion de l'état global et des interactions avec le serveur.
// Le [GameController] ci-dessous centralise toute la logique métier côté client.
import 'dart:async';
import 'dart:developer';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../services/socket_service.dart';
import 'models.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;
import 'package:vibration/vibration.dart';

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
  // Affiche un compte à rebours local avant la révélation des rôles.
  // Aucun timer supplémentaire n'est conservé après la fin du compte à rebours.

  /// Tente de restaurer les préférences depuis le stockage local.
  /// Ne reconnecte PAS automatiquement à une ancienne partie pour éviter
  /// d'attacher une nouvelle instance à une session existante.
  Future<void> _restoreSession() async {
    final prefs = await SharedPreferences.getInstance();
    final url = prefs.getString('serverUrl');
    if (url != null) {
      state = state.copy(serverUrl: url);
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
      isOwner: false,
      hasSnapshot: false,
      role: null,
      phase: GamePhase.LOBBY,
      round: 0,
      players: [],
      deadlineMs: null,
      maxPlayers: 4,
      wolvesTargets: [],
      wolvesLockedTargetId: null,
      confirmationsRemaining: 0,
      witchWake: null,
      hunterTargets: [],
      seerTargets: [],
      seerLog: [],
      recap: null,
      voteAlive: [],
      lastVote: null,
      winner: null,
      finalRoles: [],
      youReadyLocal: false,
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
        if (ack['ok'] != true) {
          // Session périmée: nettoie et laisse l'UI recréer proprement
          state = state.copy(gameId: null, playerId: null, isOwner: false, hasSnapshot: false);
          await _clearSession();
        } else {
          await _setContext();
        }
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
      final now = DateTime.now().millisecondsSinceEpoch;
      final seconds = (data['countdownSeconds'] is num)
          ? (data['countdownSeconds'] as num).toInt()
          : 10;
      final pressMs = (data['pressToRevealMs'] is num)
          ? (data['pressToRevealMs'] as num).toInt()
          : state.rolePressRevealMs;
      final until = now + seconds * 1000;
      // Affiche localement un compte à rebours configuré côté serveur,
      // même si l'état serveur bouge rapidement après l'assignation.
      state = state.copy(
        role: role,
        phase: GamePhase.ROLES,
        roleRevealUntilMs: until,
        rolePressRevealMs: pressMs,
        youReadyLocal: false,
      );
      log('[evt] role:assigned $role');
    });

    s.on('game:stateChanged', (data) async {
      final wasClosing = state.closingEyes;
      final phase = phaseFromStr(data['state']);
      final deadline = data['deadline'] as int?;
      final closing = data['closingEyes'] == true;
      // Robustness: si on n'est plus en phase Amoureux, masque l'écran localement
      final loverPartnerId = phase == GamePhase.NIGHT_LOVERS ? state.loverPartnerId : null;
      state = state.copy(phase: phase, deadlineMs: deadline, loverPartnerId: loverPartnerId, closingEyes: closing);
      if (wasClosing && !closing) {
        try { await _vibrateWakeIfAlive(); } catch (_) {}
      }
      log('[evt] game:stateChanged $phase deadline=$deadline');
    });

    s.on('game:snapshot', (data) async {
      final wasClosing = state.closingEyes;
      // sync full snapshot
      final players = ((data['players'] as List?) ?? [])
          .map((e) => Map<String, dynamic>.from(e))
          .map((j) => PlayerView(
                id: j['id'],
                connected: j['connected'] == true,
                alive: j['alive'] == true,
                ready: j['ready'] == true,
              ))
          .toList();
      final rawRole = (data['you'] as Map?)?['role'];
      final youId = (data['you'] as Map?)?['id']?.toString();
      final role = rawRole is String ? roleFromStr(rawRole) : state.role;
      final phase = phaseFromStr(data['state']);
      final deadline = data['deadline'] as int?;
      final closing = data['closingEyes'] == true;
      final maxPlayers = (data['maxPlayers'] as int?) ?? state.maxPlayers;
      final snapshotGameId = data['id']?.toString();
      // Si nous n'avions pas encore les identifiants (fallback quand l'ACK a échoué),
      // les récupérer depuis le snapshot pour permettre à l'UI d'avancer.
      final nextGameId = state.gameId ?? snapshotGameId;
      final nextPlayerId = state.playerId ?? youId;
      final isOwner = players.isNotEmpty && nextPlayerId != null && players.first.id == nextPlayerId;
      state = state.copy(
        gameId: nextGameId,
        playerId: nextPlayerId,
        phase: phase,
        players: players,
        role: role,
        deadlineMs: deadline,
        closingEyes: closing,
        maxPlayers: maxPlayers,
        isOwner: isOwner,
        hasSnapshot: true,
      );
      if (wasClosing && !closing) {
        try { await _vibrateWakeIfAlive(); } catch (_) {}
      }
      // Si nous venons d'apprendre gameId/playerId via le snapshot, fixe le contexte
      // et persiste la session afin d'éviter toute désynchronisation.
      if ((snapshotGameId != null || youId != null) && (state.gameId != null && state.playerId != null)) {
        try { await _setContext(); } catch (_) {}
        try { await _saveSession(); } catch (_) {}
      }
      log('[evt] game:snapshot role=$role phase=$phase players=${players.length}');
    });

    // Fin de partie: inclut désormais la liste des amoureux pour marquer
    // (amoureux) côté client chez tout le monde, même sans info locale.
    s.on('game:ended', (data) {
      final win = data['winner'] as String?;
      final roles = ((data['roles'] as List?) ?? [])
          .map((e) => Map<String, dynamic>.from(e))
          .map<(String, Role)>((j) => (
                j['playerId'] as String,
                roleFromStr(j['role'] as String),
              ))
          .toList();
      final lovers = ((data['lovers'] as List?) ?? [])
          .map((e) => e.toString())
          .toSet();
      state = state.copy(
        winner: win,
        phase: GamePhase.END,
        finalRoles: roles,
        loversKnown: lovers.isNotEmpty ? lovers : state.loversKnown,
      );
      log('[evt] game:ended winner=$win roles=${roles.length} lovers=${lovers.length}');
    });

    s.on('game:cancelled', (_) async {
      _resetGameState();
      await _clearSession();
      log('[evt] game:cancelled');
    });

    // --- Phase de nuit : rôle Voyante ---
    // Réveil : le serveur envoie la liste des joueurs vivants sondables.
    s.on('seer:wake', (data) async {
      final list = ((data['alive'] as List?) ?? [])
          .map((e) => Map<String, dynamic>.from(e))
          .map((j) => Lite(id: j['id']))
          .toList();
      state = state.copy(seerTargets: list);
      if (state.vibrations) await HapticFeedback.vibrate();
      log('[evt] seer:wake targets=${list.length}');
    });

    // Réception d'une révélation de rôle suite à `seer:peek`.
    s.on('seer:reveal', (data) {
      final pid = data['playerId']?.toString();
      final roleStr = data['role']?.toString();
      if (pid == null || roleStr == null) return;
      Role role;
      try {
        role = roleFromStr(roleStr);
      } catch (_) {
        return;
      }
      final logList = [...state.seerLog, (pid, role)];
      state = state.copy(seerLog: logList, seerPending: (pid, role));
      log('[evt] seer:reveal target=$pid role=$roleStr');
    });

    // Fin de phase : la voyante se rendort.
    s.on('seer:sleep', (_) async {
      state = state.copy(seerTargets: [], seerPending: null);
      log('[evt] seer:sleep');
    });

    // --- Night: wolves
    s.on('wolves:wake', (data) async {
      final list = ((data['alive'] as List?) ?? [])
          .map((e) => Map<String, dynamic>.from(e))
          .map((j) => Lite(id: j['id']))
          .toList();
      // Réinitialise le dernier comptage (égalité) à chaque réveil des loups
      state = state.copy(wolvesTargets: list, wolvesLockedTargetId: null, confirmationsRemaining: 0, wolvesLastTally: null);
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

    // Wolves: tie results (re-vote like village)
    // Egalité côté loups: affiche un comptage détaillé et invite à revoter
    s.on('wolves:results', (data) {
      final tallyMap = <String, int>{};
      (data['tally'] as Map?)?.forEach((k, v) => tallyMap[k.toString()] = (v as num).toInt());
      state = state.copy(wolvesLastTally: tallyMap);
      log('[evt] wolves:results tie tally=${tallyMap.length}');
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

    // --- Night: cupid
    s.on('cupid:wake', (data) async {
      final list = ((data['alive'] as List?) ?? [])
          .map((e) => Map<String, dynamic>.from(e))
          .map((j) => Lite(id: j['id']))
          .toList();
      state = state.copy(cupidTargets: list);
      if (state.vibrations) await HapticFeedback.vibrate();
      log('[evt] cupid:wake targets=${list.length}');
    });

    s.on('lovers:wake', (data) async {
      final partnerId = data['partnerId'] as String?;
      // secret info: only for you if you're lover
      final you = state.playerId;
      final known = {...state.loversKnown};
      if (you != null) known.add(you);
      if (partnerId != null) known.add(partnerId);
      state = state.copy(loverPartnerId: partnerId, loversKnown: known);
      if (state.vibrations) await HapticFeedback.vibrate();
      log('[evt] lovers:wake partner=$partnerId');
    });

    // Amoureux: fin de la révélation -> refermer l'écran côté client
    s.on('lovers:sleep', (_) async {
      state = state.copy(loverPartnerId: null);
      log('[evt] lovers:sleep');
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
          .map((e) => e.toString())
          .toList();
      final recap = DayRecap(deaths: deaths, hunterKills: hunterKills);
      final deadIds = deaths.map((d) => d.$1).toSet();
      final updatedPlayers = state.players
          .map((p) => deadIds.contains(p.id)
              ? PlayerView(id: p.id, connected: p.connected, alive: false, ready: p.ready)
              : p)
          .toList();
      state = state.copy(recap: recap, players: updatedPlayers, hunterTargets: []);
      if (state.vibrations) await HapticFeedback.vibrate();
      log('[evt] day:recap deaths=${deaths.length} hunterKills=${hunterKills.length}');
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

    // Statut de vote (nombre de bulletins déposés / en attente)
    s.on('vote:status', (data) {
      final voted = (data['voted'] as num?)?.toInt() ?? 0;
      final total = (data['total'] as num?)?.toInt() ?? 0;
      final pending = ((data['pending'] as List?) ?? [])
          .map((e) => Map<String, dynamic>.from(e))
          .map((j) => j['id'] as String)
          .join(', ');
      log('[evt] vote:status $voted/$total pending=[$pending]');
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
                  ? PlayerView(id: p.id, connected: p.connected, alive: false, ready: p.ready)
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
      maxPlayers: (data['maxPlayers'] as int?) ?? maxPlayers,
      isOwner: true,
      hasSnapshot: false,
    );
    await _setContext();
    // rafraîchit le lobby pour disposer d'un fallback fiable (compteur)
    try { await _listGames(); } catch (_) {}
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
      isOwner: false,
      hasSnapshot: false,
    );
    await _setContext();
    // rafraîchit le lobby pour disposer d'un fallback fiable (compteur)
    try { await _listGames(); } catch (_) {}
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
        log('cancelGame error: $err');
        // Tolère game_not_found côté client: on nettoie quand même l'état
        if (err == 'game_not_found' || err == 'invalid_payload' || err == 'invalid_context') err = null;
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
        log('leaveGame error: $err');
        // Tolère game_not_found côté client (ex: jeu déjà annulé)
        if (err == 'game_not_found' || err == 'invalid_payload' || err == 'invalid_context') err = null;
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
    // Demande explicitement un snapshot après avoir fixé le contexte
    try {
      final ack2 = await _socketSvc.emitAck('session:resume', {
        'gameId': state.gameId,
        'playerId': state.playerId,
      });
      log('[ack] session:resume(post-context) $ack2');
    } catch (e) {
      log('session:resume post-context failed: $e');
    }
  }

  /// Permet de relancer une synchronisation (context + snapshot)
  /// si l'UI est affichée mais aucun snapshot n'a encore été reçu.
  Future<void> ensureSynced() async {
    if (state.gameId == null || state.playerId == null) return;
    if (state.hasSnapshot) return;
    await _setContext();
  }

  Future<void> toggleReady(bool ready) async {
    final event = ready ? 'player:ready' : 'player:unready';
    // Optimistic update for immediate UI feedback
    state = state.copy(youReadyLocal: ready);
    var ack = await _socketSvc.emitAck(event, {});
    log('[ack] $event $ack');
    // Auto-heal missing context by re-sending context and retrying once
    if (ack['ok'] != true) {
      final err = (ack['error'] ?? '').toString();
      if (err == 'missing_context' || err == 'invalid_context') {
        try {
          await _setContext();
          ack = await _socketSvc.emitAck(event, {});
          log('[ack] retry $event $ack');
        } catch (e) {
          log('retry $event failed: $e');
        }
      }
    }
    // If still rejected, revert local flag to reflect server state
    if (ack['ok'] != true) state = state.copy(youReadyLocal: !ready);
    if (ready) {
      // Une fois prêt, masque l'écran de rôle pour laisser place à la phase suivante.
      state = state.copy(roleRevealUntilMs: null);
    }
  }

  // Vibrations au réveil: 5s de vibration moyenne, seulement si le joueur local est vivant.
  Future<void> _vibrateWakeIfAlive() async {
    try {
      final meId = state.playerId;
      if (meId == null) return;
      final me = state.players.firstWhere(
        (p) => p.id == meId,
        orElse: () => const PlayerView(id: '', connected: true, alive: true),
      );
      if (!me.alive) return;
      if (!state.vibrations) return;

      final hasVib = await Vibration.hasVibrator() ?? false;
      if (hasVib) {
        final hasAmp = await Vibration.hasCustomVibrationsSupport() ?? false;
        if (hasAmp) {
          await Vibration.vibrate(duration: 5000, amplitude: 128);
        } else {
          await Vibration.vibrate(duration: 5000);
        }
      } else {
        // Fallback: pulses HapticFeedback pendant ~5s
        const totalMs = 5000;
        const stepMs = 300;
        int elapsed = 0;
        while (elapsed < totalMs) {
          try { await HapticFeedback.mediumImpact(); } catch (_) {}
          await Future.delayed(const Duration(milliseconds: stepMs));
          elapsed += stepMs;
        }
      }
    } catch (_) {}
  }

  // ------------- Wolves -------------
  /// Envoie le choix de la cible du loup au serveur.
  ///
  /// Explications pour un débutant (et non joueur):
  /// - Dans le jeu, la phase « loups » consiste à choisir un villageois à éliminer.
  /// - Le serveur valide ou rejette la demande via un ACK (accusé de réception).
  /// - Certains choix sont interdits, par exemple si le loup est amoureux d’un joueur,
  ///   il ne peut pas le cibler (règle métier côté serveur).
  ///
  /// Robustesse côté client:
  /// - Nous n’« enfermons » plus l’UI en mode validé tant que le serveur n’a pas
  ///   accepté l’action (ack ok). Cela évite l’état « rien ne se passe » si le serveur
  ///   rejette le choix.
  /// - Si le contexte de socket est manquant (gameId/playerId pas encore fixés côté
  ///   serveur), on tente une auto-réparation en renvoyant d’abord `context:set` puis
  ///   en rejouant l’action une seule fois.
  /// - En cas d’erreur, on retourne un message utilisateur compréhensible pour l’UI.
  Future<String?> wolvesChoose(String targetId) async {
    // 1) Envoi standard
    var ack = await _socketSvc.emitAck('wolves:chooseTarget', {'targetId': targetId});
    log('[ack] wolves:chooseTarget $ack');
    if (ack['ok'] == true) return null;
    final err = (ack['error'] ?? '').toString();
    // 2) Auto-réparation si le contexte manque, puis un seul retry
    if (err == 'missing_context' || err == 'invalid_context') {
      try {
        await _setContext();
        ack = await _socketSvc.emitAck('wolves:chooseTarget', {'targetId': targetId});
        log('[ack] retry wolves:chooseTarget $ack');
        if (ack['ok'] == true) return null;
      } catch (e) {
        log('retry wolves:chooseTarget failed: $e');
      }
    }
    // 3) Adapter les erreurs connues vers des messages lisibles par l’utilisateur
    switch (err) {
      case 'cannot_target_lover':
        return "Vous ne pouvez pas cibler votre amoureux·se.";
      case 'invalid_target':
        return "Cible invalide (déjà morte ou interdite).";
      case 'forbidden':
        return "Action non autorisée pour votre rôle.";
      case 'bad_state':
        return "Phase incompatible avec cette action.";
      default:
        return err.isEmpty ? 'action_failed' : err;
    }
  }

  // ------------- Witch -------------
  Future<void> witchDecision({required bool save, String? poisonTargetId}) async {
    final payload = {'save': save, if (poisonTargetId != null) 'poisonTargetId': poisonTargetId};
    final ack = await _socketSvc.emitAck('witch:decision', payload);
    log('[ack] witch:decision $ack');
  }

  // ------------- Cupid -------------
  Future<void> cupidChoose(String targetAId, String targetBId) async {
    final ack = await _socketSvc.emitAck('cupid:choose', {
      'targetA': targetAId,
      'targetB': targetBId,
    });
    log('[ack] cupid:choose $ack');
    state = state.copy(cupidTargets: []);
  }

  // ------------- Lovers Ack -------------
  Future<void> loversAck() async {
    final ack = await _socketSvc.emitAck('lovers:ack', {});
    log('[ack] lovers:ack $ack');
  }

  // ------------- Seer -------------
  /// Envoie au serveur la cible que la voyante souhaite sonder.
  /// Le serveur répondra ensuite avec l'évènement `seer:reveal`.
  Future<void> seerPeek(String targetId) async {
    final ack = await _socketSvc.emitAck('seer:peek', {'targetId': targetId});
    log('[ack] seer:peek $ack');
  }

  /// ACK de lecture de la voyante pour passer à la phase suivante.
  Future<void> seerAck() async {
    final ack = await _socketSvc.emitAck('seer:ack', {});
    log('[ack] seer:ack $ack');
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
  Future<String?> voteCast(String targetId) async {
    final ack = await _socketSvc.emitAck('vote:cast', {'targetId': targetId});
    log('[ack] vote:cast $ack');
    if (ack['ok'] != true) {
      final err = ack['error']?.toString() ?? 'unknown_error';
      switch (err) {
        case 'cannot_target_lover':
          return "Vous ne pouvez pas voter contre votre amoureux·se.";
        case 'invalid_target':
          return "Cible invalide ou morte.";
        case 'dead_cannot_vote':
          return "Vous ne pouvez pas voter (mort).";
        case 'bad_state':
          return "Le vote n'est plus ouvert.";
        default:
          return err;
      }
    }
    return null;
  }

  Future<void> voteCancel() async {
    final ack = await _socketSvc.emitAck('vote:cancel', {});
    log('[ack] vote:cancel $ack');
  }

  // ------------- Vote resolve ack (day elimination) -------------
  // Envoie l'ACK "J'ai vu" après un vote diurne (phase RESOLVE)
  Future<void> voteAck() async {
    final ack = await _socketSvc.emitAck('vote:ack', {});
    log('[ack] vote:ack $ack');
  }

  // ------------- Reset -------------
  Future<void> leaveToHome() async {
    _socketSvc.dispose();
    state = GameModel.initial();
    await _clearSession();
  }
}
