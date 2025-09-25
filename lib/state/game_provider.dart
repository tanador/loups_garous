// Couche "state": gestion de l'état global et des interactions avec le serveur.
// Le [GameController] ci-dessous centralise toute la logique métier côté client.
import 'dart:async';
import 'package:flutter/services.dart';
import '../utils/app_logger.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:meta/meta.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../services/socket_service.dart';
import 'models.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;
import 'package:vibration/vibration.dart';

final gameProvider =
    NotifierProvider<GameController, GameModel>(GameController.new);

/// Contrôleur principal de l'application.
/// Il maintient l'état du jeu dans [GameModel] et gère
/// la communication avec le serveur via Socket.IO.
///
/// Guide rapide pour débutants – Orchestration & évènements
///
/// Phases (FSM) côté serveur
///   LOBBY → ROLES → (NIGHT_CUPID → NIGHT_LOVERS)? → NIGHT_WOLVES → NIGHT_WITCH →
///   MORNING → VOTE → RESOLVE → CHECK_END → (END | retour NIGHT_WOLVES)
///
/// Evènements clés écoutés par ce contrôleur et usage UI
///   - game:stateChanged: mise à jour de la phase/délais. Utilisé pour afficher
///     ou masquer les écrans de rôle, vote, recap, etc.
///   - game:snapshot: synchronisation complète (joueurs vivants, rôle secret,
///     deadlines). Toujours utilisé comme vérité serveur.
///   - day:recap: récapitulatif du matin (morts de la nuit) ou de la journée
///     (après vote). Affiche l'écran Morning ou DayRecap et expose un bouton
///     "J'ai lu" qui envoie day:ack.
///   - vote:options|status|results: ouvre l'écran Vote, met à jour l'état puis
///     publie un récapitulatif.
///   - wolves:wake / witch:wake / cupid:wake / lovers:wake / seer:wake:
///     réveils privés. Chaque écran consomme la liste des cibles et émet une
///     commande d'ACK/choix vers le serveur.
///   - hunter:wake: réveil privé du Chasseur, même s'il est mort. Le routeur
///     affiche l'écran de tir dès que [state.hunterTargets] n'est pas vide.
///
/// Rappels d’ACK (pour éviter les blocages)
///   - Seuls les survivants comptent pour day:ack (MORNING et RESOLVE).
///   - Le chasseur est réveillé APRES l’ACK des survivants le matin, si un
///     chasseur est mort pendant la nuit (ou par chagrin).
class GameController extends Notifier<GameModel> {
  @override
  GameModel build() {
    // Restore persisted preferences/session on startup.
    // This is fire-and-forget; it may update state asynchronously.
    // ignore: discarded_futures
    _restoreSession();
    return GameModel.initial();
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
      youVoted: false,
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
      AppLogger.log('[event] connect');
      // Si nous avions déjà rejoint une partie, tentons de reprendre la session.
      if (state.gameId != null && state.playerId != null) {
        final ack = await _socketSvc.emitAck('session:resume', {
          'gameId': state.gameId,
          'playerId': state.playerId,
        });
        AppLogger.log('[ack] session:resume $ack');
        if (ack['ok'] != true) {
          // Session périmée: nettoie et laisse l'UI recréer proprement
          state = state.copy(
              gameId: null, playerId: null, isOwner: false, hasSnapshot: false);
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
      AppLogger.log('[event] disconnect');
    });

    // --- Lobby events
    s.on('lobby:updated', (data) {
      final games = (data?['games'] as List?)
              ?.map((e) => LobbyGameInfo.fromJson(Map<String, dynamic>.from(e)))
              .toList() ??
          [];
      state = state.copy(lobby: games);
      AppLogger.log('[evt] lobby:updated ${games.length}');
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
      AppLogger.log('[evt] role:assigned $role');
    });

    s.on('game:stateChanged', (data) async {
      final previousPhase = state.phase;
      final phase = phaseFromStr(data['state']);
      final deadline = data['deadline'] as int?;
      final closing = data['closingEyes'] == true;
      final vibCfg = _parseVibrationConfig(data['config']);
      // Robustness: si on n'est plus en phase Amoureux, masque l'écran localement
      final loverPartnerId =
          phase == GamePhase.NIGHT_LOVERS ? state.loverPartnerId : null;
      // Clear the day recap when leaving RESOLVE phase
      final clearDayRecap =
          phase != GamePhase.RESOLVE ? null : state.dayVoteRecap;
      final leavingRoles =
          previousPhase == GamePhase.ROLES && phase != GamePhase.ROLES;
      state = state.copy(
        phase: phase,
        deadlineMs: deadline,
        loverPartnerId: loverPartnerId,
        closingEyes: closing,
        hunterPending: data['hunterPending'] == true,
        youVoted: phase == GamePhase.VOTE ? state.youVoted : false,
        dayVoteRecap: clearDayRecap,
        vibrationPulses: vibCfg?.pulses ?? state.vibrationPulses,
        vibrationPulseMs: vibCfg?.pulseMs ?? state.vibrationPulseMs,
        vibrationPauseMs: vibCfg?.pauseMs ?? state.vibrationPauseMs,
        vibrationForce: vibCfg?.force ?? state.vibrationForce,
        roleRevealUntilMs:
            phase == GamePhase.ROLES ? state.roleRevealUntilMs : null,
        youReadyLocal: leavingRoles ? false : state.youReadyLocal,
      );
      if (previousPhase != phase &&
          GameController.shouldVibrateWake(state, phase)) {
        try {
          await _vibrateWakeIfAlive();
        } catch (_) {}
      }
      AppLogger.log('[evt] game:stateChanged $phase deadline=$deadline');
    });

    s.on('game:snapshot', (data) async {
      final wasClosing = state.closingEyes;
      final wasAliveBefore = _youAlive();
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
      final vibCfg = _parseVibrationConfig(data['config']);
      final snapshotGameId = data['id']?.toString();
      // Si nous n'avions pas encore les identifiants (fallback quand l'ACK a échoué),
      // les récupérer depuis le snapshot pour permettre à l'UI d'avancer.
      final nextGameId = state.gameId ?? snapshotGameId;
      final nextPlayerId = state.playerId ?? youId;
      final isOwner = players.isNotEmpty &&
          nextPlayerId != null &&
          players.first.id == nextPlayerId;
      state = state.copy(
        gameId: nextGameId,
        playerId: nextPlayerId,
        phase: phase,
        players: players,
        role: role,
        deadlineMs: deadline,
        closingEyes: closing,
        hunterPending: data['hunterPending'] == true,
        maxPlayers: maxPlayers,
        isOwner: isOwner,
        hasSnapshot: true,
        vibrationPulses: vibCfg?.pulses ?? state.vibrationPulses,
        vibrationPulseMs: vibCfg?.pulseMs ?? state.vibrationPulseMs,
        vibrationPauseMs: vibCfg?.pauseMs ?? state.vibrationPauseMs,
        vibrationForce: vibCfg?.force ?? state.vibrationForce,
        youVoted: phase == GamePhase.VOTE ? state.youVoted : false,
        // Déclenche l'animation si l'on apprend via snapshot qu'on vient de mourir
        showDeathAnim: state.showDeathAnim ||
            (wasAliveBefore &&
                !(players
                    .firstWhere(
                      (p) => p.id == (nextPlayerId ?? ''),
                      orElse: () => const PlayerView(
                          id: '', connected: true, alive: true),
                    )
                    .alive)),
      );
      if (wasClosing && !closing) {
        try {
          await _vibrateWakeIfAlive();
        } catch (_) {}
      }
      // Si nous venons d'apprendre gameId/playerId via le snapshot, fixe le contexte
      // et persiste la session afin d'éviter toute désynchronisation.
      if ((snapshotGameId != null || youId != null) &&
          (state.gameId != null && state.playerId != null)) {
        try {
          await _setContext();
        } catch (_) {}
        try {
          await _saveSession();
        } catch (_) {}
      }
      AppLogger.log(
          '[evt] game:snapshot role=$role phase=$phase players=${players.length}');
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
      final lovers =
          ((data['lovers'] as List?) ?? []).map((e) => e.toString()).toSet();
      state = state.copy(
        winner: win,
        phase: GamePhase.END,
        finalRoles: roles,
        loversKnown: lovers.isNotEmpty ? lovers : state.loversKnown,
      );
      AppLogger.log(
          '[evt] game:ended winner=$win roles=${roles.length} lovers=${lovers.length}');
    });

    s.on('game:cancelled', (_) async {
      _resetGameState();
      await _clearSession();
      AppLogger.log('[evt] game:cancelled');
    });

    // --- Phase de nuit : rôle Voyante ---
    // Réveil : le serveur envoie la liste des joueurs vivants sondables.
    s.on('seer:wake', (data) async {
      final list = ((data['alive'] as List?) ?? [])
          .map((e) => Map<String, dynamic>.from(e))
          .map((j) => Lite(id: j['id']))
          .toList();
      state = state.copy(seerTargets: list);
      if (state.vibrations && _youAlive()) await HapticFeedback.vibrate();
      AppLogger.log('[evt] seer:wake targets=${list.length}');
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
      AppLogger.log('[evt] seer:reveal target=$pid role=$roleStr');
    });

    // Fin de phase : la voyante se rendort.
    s.on('seer:sleep', (_) async {
      state = state.copy(seerTargets: [], seerPending: null);
      AppLogger.log('[evt] seer:sleep');
    });

    // --- Night: wolves
    s.on('wolves:wake', (data) async {
      final list = ((data['alive'] as List?) ?? [])
          .map((e) => Map<String, dynamic>.from(e))
          .map((j) => Lite(id: j['id']))
          .toList();
      // Réinitialise le dernier comptage (égalité) à chaque réveil des loups
      state = state.copy(
          wolvesTargets: list,
          wolvesLockedTargetId: null,
          confirmationsRemaining: 0,
          wolvesLastTally: null);
      if (state.vibrations && _youAlive()) await HapticFeedback.vibrate();
      AppLogger.log('[evt] wolves:wake targets=${list.length}');
    });

    s.on('wolves:targetLocked', (data) {
      state = state.copy(
        wolvesLockedTargetId: data['targetId'] as String?,
        confirmationsRemaining: (data['confirmationsRemaining'] ?? 0) as int,
      );
      AppLogger.log(
          '[evt] wolves:targetLocked ${state.wolvesLockedTargetId} confLeft=${state.confirmationsRemaining}');
    });

    // Wolves: tie results (re-vote like village)
    // Egalité côté loups: affiche un comptage détaillé et invite à revoter
    s.on('wolves:results', (data) {
      final tallyMap = <String, int>{};
      (data['tally'] as Map?)
          ?.forEach((k, v) => tallyMap[k.toString()] = (v as num).toInt());
      state = state.copy(wolvesLastTally: tallyMap);
      AppLogger.log('[evt] wolves:results tie tally=${tallyMap.length}');
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
      if (state.vibrations && _youAlive()) await HapticFeedback.vibrate();
      AppLogger.log(
          '[evt] witch:wake attacked=${ww.attacked} heal=${ww.healAvailable} poison=${ww.poisonAvailable}');
    });

    // --- Night: cupid
    s.on('cupid:wake', (data) async {
      final list = ((data['alive'] as List?) ?? [])
          .map((e) => Map<String, dynamic>.from(e))
          .map((j) => Lite(id: j['id']))
          .toList();
      state = state.copy(cupidTargets: list);
      if (state.vibrations && _youAlive()) await HapticFeedback.vibrate();
      AppLogger.log('[evt] cupid:wake targets=${list.length}');
    });

    s.on('lovers:wake', (data) async {
      final partnerId = data['partnerId'] as String?;
      // secret info: only for you if you're lover
      final you = state.playerId;
      final known = {...state.loversKnown};
      if (you != null) known.add(you);
      if (partnerId != null) known.add(partnerId);
      state = state.copy(loverPartnerId: partnerId, loversKnown: known);
      if (state.vibrations && _youAlive()) await HapticFeedback.vibrate();
      AppLogger.log('[evt] lovers:wake partner=$partnerId');
    });

    // Amoureux: fin de la révélation -> refermer l'écran côté client
    s.on('lovers:sleep', (_) async {
      state = state.copy(loverPartnerId: null);
      AppLogger.log('[evt] lovers:sleep');
    });

    // --- Hunter ability
    s.on('hunter:pending', (data) {
      final active = data['active'] == true;
      state = state.copy(hunterPending: active);
      AppLogger.log('[evt] hunter:pending active=$active');
    });

    s.on('hunter:wake', (data) async {
      final alive = ((data['alive'] as List?) ?? [])
          .map((e) => Map<String, dynamic>.from(e))
          .map((j) => Lite(id: j['id']))
          .toList();
      state = state.copy(hunterTargets: alive);
      if (state.vibrations && _youAlive()) await HapticFeedback.vibrate();
      AppLogger.log('[evt] hunter:wake targets=${alive.length}');
    });

    // --- Morning & Day recap (shared event name)
    s.on('day:recap', (data) async {
      final map = Map<String, dynamic>.from(data ?? {});
      if (map.containsKey('votes')) {
        // Daytime recap after vote
        final eliminated = ((map['eliminated'] as List?) ?? [])
            .map((e) => e.toString())
            .toList();
        final votes = ((map['votes'] as List?) ?? [])
            .map((e) => Map<String, dynamic>.from(e))
            .map<(String, String?)>(
                (j) => (j['voterId'] as String, j['targetId'] as String?))
            .toList();
        final recap = DayVoteRecap(eliminated: eliminated, votes: votes);
        // Reflect locally the eliminated alive=false if present
        final deadIds = eliminated.toSet();
        final updatedPlayers = state.players
            .map((p) => deadIds.contains(p.id)
                ? PlayerView(
                    id: p.id,
                    connected: p.connected,
                    alive: false,
                    ready: p.ready)
                : p)
            .toList();
        final you = state.playerId;
        final wasAlive = _youAlive();
        final youDiedNow = you != null && eliminated.contains(you) && wasAlive;
        state = state.copy(
          dayVoteRecap: recap,
          players: updatedPlayers,
          // Ne jamais écraser un déclenchement d'animation déjà en cours
          showDeathAnim: state.showDeathAnim || youDiedNow,
        );
        if (state.vibrations && _youAlive()) await HapticFeedback.vibrate();
        AppLogger.log(
            '[evt] day:recap (day) eliminated=${eliminated.length} votes=${votes.length}');
        return;
      }
      // Morning recap
      final deaths = ((map['deaths'] as List?) ?? [])
          .map((e) => Map<String, dynamic>.from(e))
          .map<(String, String)>(
              (j) => (j['playerId'] as String, j['role'] as String))
          .toList();
      final hunterKills = ((map['hunterKills'] as List?) ?? [])
          .map((e) => e.toString())
          .toList();
      final recap = DayRecap(deaths: deaths, hunterKills: hunterKills);
      final deadIds = {
        ...deaths.map((d) => d.$1),
        ...hunterKills,
      };
      final updatedPlayers = state.players
          .map((p) => deadIds.contains(p.id)
              ? PlayerView(
                  id: p.id,
                  connected: p.connected,
                  alive: false,
                  ready: p.ready)
              : p)
          .toList();
      final you = state.playerId;
      final wasAlive = _youAlive();
      final youDiedNow = you != null && deadIds.contains(you) && wasAlive;
      final preserveHunterTargets =
          state.hunterTargets.isNotEmpty && hunterKills.isEmpty;
      final nextHunterTargets = preserveHunterTargets
          ? List<Lite>.from(state.hunterTargets)
          : <Lite>[];
      state = state.copy(
        recap: recap,
        players: updatedPlayers,
        hunterTargets: nextHunterTargets,
        // Ne pas annuler une animation déjà déclenchée par un événement précédent
        showDeathAnim: state.showDeathAnim || youDiedNow,
      );
      if (state.vibrations && _youAlive()) await HapticFeedback.vibrate();
      AppLogger.log(
          '[evt] day:recap (morning) deaths=${deaths.length} hunterKills=${hunterKills.length}');
    });

    // --- Vote
    s.on('vote:options', (data) {
      final alive = ((data['alive'] as List?) ?? [])
          .map((e) => Map<String, dynamic>.from(e))
          .map((j) => Lite(id: j['id']))
          .toList();
      state = state.copy(voteAlive: alive, lastVote: null, youVoted: false);
      AppLogger.log('[evt] vote:options ${alive.length}');
    });

    // Statut de vote (nombre de bulletins déposés / en attente)
    s.on('vote:status', (data) {
      final voted = (data['voted'] as num?)?.toInt() ?? 0;
      final total = (data['total'] as num?)?.toInt() ?? 0;
      final pendingList = ((data['pending'] as List?) ?? [])
          .map((e) => Map<String, dynamic>.from(e))
          .map((j) => j['id'] as String)
          .toList();
      final pendingLabel = pendingList.join(', ');
      final youId = state.playerId;
      final youVoted = youId != null && !pendingList.contains(youId);
      state = state.copy(youVoted: youVoted);
      AppLogger.log(
          '[evt] vote:status $voted/$total pending=[$pendingLabel] youVoted=$youVoted');
    });

    s.on('vote:results', (data) {
      final tallyMap = <String, int>{};
      (data['tally'] as Map?)
          ?.forEach((k, v) => tallyMap[k.toString()] = (v as num).toInt());
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
                  ? PlayerView(
                      id: p.id,
                      connected: p.connected,
                      alive: false,
                      ready: p.ready)
                  : p)
              .toList();
      // Détection si je viens d'être éliminé(e) par le vote
      final you = state.playerId;
      final wasAlive = _youAlive();
      final youDiedNow =
          you != null && elimId != null && you == elimId && wasAlive;
      state = state.copy(
          lastVote: vr,
          players: updatedPlayers,
          showDeathAnim: youDiedNow,
          youVoted: false);
      AppLogger.log(
          '[evt] vote:results eliminated=${vr.eliminatedId} role=${vr.role}');
    });

    // --- Thief (Voleur)
    // --- Thief (Voleur) — Nuit 0
    // Reçoit les 2 rôles des cartes du centre (privé pour le voleur).
    s.on('thief:wake', (data) async {
      final center = ((data['center'] as List?) ?? [])
          .map((e) => Map<String, dynamic>.from(e))
          .map((j) => roleFromStr(j['role'] as String))
          .toList();
      state = state.copy(thiefCenter: center);
      if (state.vibrations) await HapticFeedback.vibrate();
      AppLogger.log(
          '[evt] thief:wake center=${center.map((r) => r.name).join("/")}');
    });
    // Fin de l'étape Voleur: efface l'aperçu local
    s.on('thief:sleep', (_) async {
      state = state.copy(thiefCenter: []);
      AppLogger.log('[evt] thief:sleep');
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
    final ack = await _socketSvc.emitAck(
        'lobby:create', {'nickname': nickname, 'maxPlayers': maxPlayers});
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
    try {
      await _listGames();
    } catch (_) {}
    await _saveSession();
    return null;
  }

  Future<String?> joinGame(String gameId, String nickname) async {
    final ack = await _socketSvc
        .emitAck('lobby:join', {'gameId': gameId, 'nickname': nickname});
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
    try {
      await _listGames();
    } catch (_) {}
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
      AppLogger.log('[ack] lobby:cancel $ack');
      if (ack['ok'] != true) {
        err = ack['error']?.toString() ?? 'unknown_error';
        AppLogger.log('cancelGame error: $err');
        // Tolère game_not_found côté client: on nettoie quand même l'état
        if (err == 'game_not_found' ||
            err == 'invalid_payload' ||
            err == 'invalid_context') {
          err = null;
        }
      }
    } catch (e, st) {
      err = e.toString();
      AppLogger.log('cancelGame exception: $err', stackTrace: st);
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
      AppLogger.log('[ack] lobby:leave $ack');
      if (ack['ok'] != true) {
        err = ack['error']?.toString() ?? 'unknown_error';
        AppLogger.log('leaveGame error: $err');
        // Tolère game_not_found côté client (ex: jeu déjà annulé)
        if (err == 'game_not_found' ||
            err == 'invalid_payload' ||
            err == 'invalid_context') {
          err = null;
        }
      }
    } catch (e, st) {
      err = e.toString();
      AppLogger.log('leaveGame exception: $err', stackTrace: st);
    }
    _resetGameState();
    await _clearSession();
    return err;
  }

  Future<void> refreshLobby() => _listGames();

  Future<void> toggleVibrations(bool on) async {
    state = state.copy(vibrations: on);
  }

  @visibleForTesting
  static bool shouldVibrateWake(GameModel snapshot, GamePhase phase) {
    final role = snapshot.role;
    switch (phase) {
      case GamePhase.NIGHT_THIEF:
        return role == Role.THIEF;
      case GamePhase.NIGHT_CUPID:
        return role == Role.CUPID;
      case GamePhase.NIGHT_LOVERS:
        final me = snapshot.playerId;
        if (me == null) return false;
        if (snapshot.loverPartnerId != null) return true;
        return snapshot.loversKnown.contains(me);
      case GamePhase.NIGHT_SEER:
        return role == Role.SEER;
      case GamePhase.NIGHT_WOLVES:
        return role == Role.WOLF;
      case GamePhase.NIGHT_WITCH:
        return role == Role.WITCH;
      case GamePhase.MORNING:
      case GamePhase.VOTE:
        return true;
      default:
        return false;
    }
  }

  // ------------- Context & ready -------------
  Future<void> _setContext() async {
    final ack = await _socketSvc.emitAck('context:set', {
      'gameId': state.gameId,
      'playerId': state.playerId,
    });
    AppLogger.log('[ack] context:set $ack');
    // Demande explicitement un snapshot après avoir fixé le contexte
    try {
      final ack2 = await _socketSvc.emitAck('session:resume', {
        'gameId': state.gameId,
        'playerId': state.playerId,
      });
      AppLogger.log('[ack] session:resume(post-context) $ack2');
    } catch (e) {
      AppLogger.log('session:resume post-context failed: $e');
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
    AppLogger.log('[ack] $event $ack');
    // Auto-heal missing context by re-sending context and retrying once
    if (ack['ok'] != true) {
      final err = (ack['error'] ?? '').toString();
      if (err == 'missing_context' || err == 'invalid_context') {
        try {
          await _setContext();
          ack = await _socketSvc.emitAck(event, {});
          AppLogger.log('[ack] retry $event $ack');
        } catch (e) {
          AppLogger.log('retry $event failed: $e');
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

  // Vibrations au réveil: pattern configurable côté serveur, uniquement si le joueur local est vivant.
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

      final pulses = state.vibrationPulses;
      final pulseMs = state.vibrationPulseMs;
      final pauseMs = state.vibrationPauseMs;
      if (pulses <= 0 || pulseMs <= 0) return;
      final amplitude = state.vibrationForce < 1
          ? 1
          : (state.vibrationForce > 255 ? 255 : state.vibrationForce);
      final totalMs = _totalVibrationDuration(pulses, pulseMs, pauseMs);

      if (await Vibration.hasVibrator()) {
        final supportsCustom = await Vibration.hasCustomVibrationsSupport();
        final supportsAmplitude = await Vibration.hasAmplitudeControl();
        final pattern = <int>[0];
        final intensities = <int>[0];
        for (var i = 0; i < pulses; i++) {
          pattern.add(pulseMs);
          intensities.add(amplitude);
          if (i < pulses - 1) {
            pattern.add(pauseMs);
            intensities.add(0);
          }
        }
        try {
          if (supportsCustom) {
            if (supportsAmplitude) {
              await Vibration.vibrate(
                  pattern: pattern, intensities: intensities);
            } else {
              await Vibration.vibrate(pattern: pattern);
            }
          } else if (supportsAmplitude && totalMs > 0) {
            await Vibration.vibrate(duration: totalMs, amplitude: amplitude);
          } else if (totalMs > 0) {
            await Vibration.vibrate(duration: totalMs);
          }
        } catch (_) {
          if (supportsAmplitude && totalMs > 0) {
            await Vibration.vibrate(duration: totalMs, amplitude: amplitude);
          } else if (totalMs > 0) {
            await Vibration.vibrate(duration: totalMs);
          }
        }
      } else {
        for (var i = 0; i < pulses; i++) {
          try {
            await HapticFeedback.mediumImpact();
          } catch (_) {}
          final wait = pulseMs + (i < pulses - 1 ? pauseMs : 0);
          if (wait > 0) await Future.delayed(Duration(milliseconds: wait));
        }
      }
    } catch (_) {}
  }

  static int _totalVibrationDuration(int pulses, int pulseMs, int pauseMs) {
    if (pulses <= 0 || pulseMs <= 0) return 0;
    final betweenTotal =
        pulses > 1 ? (pulses - 1) * (pauseMs < 0 ? 0 : pauseMs) : 0;
    return pulses * pulseMs + betweenTotal;
  }

  static int? _clampConfigInt(dynamic value,
      {required int min, required int max}) {
    if (value is num && value.isFinite) {
      final intVal = value.toInt();
      if (intVal < min) return min;
      if (intVal > max) return max;
      return intVal;
    }
    return null;
  }

  static ({int? pulses, int? pulseMs, int? pauseMs, int? force})?
      _parseVibrationConfig(dynamic raw) {
    if (raw is! Map) return null;
    final source = raw['vibrations'];
    final map = source is Map ? source : raw;
    final pulses = _clampConfigInt(map['count'], min: 0, max: 200);
    final pulseMs = _clampConfigInt(map['pulseMs'], min: 0, max: 60000);
    final pauseMs = _clampConfigInt(map['pauseMs'], min: 0, max: 60000);
    final force = _clampConfigInt(map['amplitude'], min: 1, max: 255);
    if (pulses == null && pulseMs == null && pauseMs == null && force == null) {
      return null;
    }
    return (pulses: pulses, pulseMs: pulseMs, pauseMs: pauseMs, force: force);
  }

  bool _youAlive() {
    try {
      final meId = state.playerId;
      if (meId == null) return false;
      final me = state.players.firstWhere(
        (p) => p.id == meId,
        orElse: () => const PlayerView(id: '', connected: true, alive: true),
      );
      return me.alive;
    } catch (_) {
      return false;
    }
  }

  // Marque l'animation de mort comme jouée (empêche les replays)
  void markDeathAnimShown() {
    if (state.showDeathAnim) {
      state = state.copy(showDeathAnim: false);
    }
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
    var ack =
        await _socketSvc.emitAck('wolves:chooseTarget', {'targetId': targetId});
    AppLogger.log('[ack] wolves:chooseTarget $ack');
    if (ack['ok'] == true) return null;
    final err = (ack['error'] ?? '').toString();
    // 2) Auto-réparation si le contexte manque, puis un seul retry
    if (err == 'missing_context' || err == 'invalid_context') {
      try {
        await _setContext();
        ack = await _socketSvc
            .emitAck('wolves:chooseTarget', {'targetId': targetId});
        AppLogger.log('[ack] retry wolves:chooseTarget $ack');
        if (ack['ok'] == true) return null;
      } catch (e) {
        AppLogger.log('retry wolves:chooseTarget failed: $e');
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
  Future<void> witchDecision(
      {required bool save, String? poisonTargetId}) async {
    final payload = {
      'save': save,
      if (poisonTargetId != null) 'poisonTargetId': poisonTargetId
    };
    final ack = await _socketSvc.emitAck('witch:decision', payload);
    AppLogger.log('[ack] witch:decision $ack');
  }

  // ------------- Cupid -------------
  Future<void> cupidChoose(String targetAId, String targetBId) async {
    final ack = await _socketSvc.emitAck('cupid:choose', {
      'targetA': targetAId,
      'targetB': targetBId,
    });
    AppLogger.log('[ack] cupid:choose $ack');
    state = state.copy(cupidTargets: []);
  }

  // ------------- Lovers Ack -------------
  Future<void> loversAck() async {
    final ack = await _socketSvc.emitAck('lovers:ack', {});
    AppLogger.log('[ack] lovers:ack $ack');
  }

  // ------------- Seer -------------
  /// Envoie au serveur la cible que la voyante souhaite sonder.
  /// Le serveur répondra ensuite avec l'évènement `seer:reveal`.
  Future<void> seerPeek(String targetId) async {
    final ack = await _socketSvc.emitAck('seer:peek', {'targetId': targetId});
    AppLogger.log('[ack] seer:peek $ack');
  }

  /// ACK de lecture de la voyante pour passer à la phase suivante.
  Future<void> seerAck() async {
    final ack = await _socketSvc.emitAck('seer:ack', {});
    AppLogger.log('[ack] seer:ack $ack');
  }

  // ------------- Hunter -------------
  Future<String?> hunterShoot(String targetId) async {
    final ack =
        await _socketSvc.emitAck('hunter:shoot', {'targetId': targetId});
    AppLogger.log('[ack] hunter:shoot $ack');
    if (ack['ok'] != true) {
      final err = ack['error']?.toString() ?? 'unknown_error';
      switch (err) {
        case 'cannot_target_lover':
          return "Vous ne pouvez pas viser votre amoureux·se.";
        case 'invalid_target':
          return "Cible invalide ou déjà morte.";
        case 'no_pending_shot':
          return "Le serveur n'attendait pas de tir.";
        case 'rate_limited':
          return "Action trop rapide, réessayez.";
        default:
          return err;
      }
    }
    state = state.copy(hunterTargets: []);
    return null;
  }

  // ------------- Morning ack -------------
  Future<void> dayAck() async {
    final ack = await _socketSvc.emitAck('day:ack', {});
    AppLogger.log('[ack] day:ack $ack');
  }

  // ------------- Vote -------------
  Future<String?> voteCast(String targetId) async {
    final ack = await _socketSvc.emitAck('vote:cast', {'targetId': targetId});
    AppLogger.log('[ack] vote:cast $ack');
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
    AppLogger.log('[ack] vote:cancel $ack');
  }

  // ------------- Vote resolve ack (day elimination) -------------
  // Envoie l'ACK "J'ai vu" après un vote diurne (phase RESOLVE)
  Future<void> voteAck() async {
    final ack = await _socketSvc.emitAck('vote:ack', {});
    AppLogger.log('[ack] vote:ack $ack');
  }

  // ------------- Thief -------------
  Future<String?> thiefKeep() async {
    final ack = await _socketSvc.emitAck('thief:choose', {'action': 'keep'});
    AppLogger.log('[ack] thief:choose keep -> $ack');
    if (ack['ok'] != true) {
      final err = (ack['error']?.toString() ?? 'unknown_error');
      if (err == 'must_take_wolf') {
        return 'Deux Loups au centre: vous devez en prendre un.';
      }
      return err;
    }
    return null;
  }

  Future<String?> thiefSwap(int index) async {
    final ack = await _socketSvc
        .emitAck('thief:choose', {'action': 'swap', 'index': index});
    AppLogger.log('[ack] thief:choose swap($index) -> $ack');
    if (ack['ok'] != true) {
      final err = (ack['error']?.toString() ?? 'unknown_error');
      if (err == 'invalid_index') return 'Choix invalide (carte inconnue).';
      return err;
    }
    return null;
  }

  // ------------- Reset -------------
  Future<void> leaveToHome() async {
    _socketSvc.dispose();
    state = GameModel.initial();
    await _clearSession();
  }
}
