import 'package:flutter/foundation.dart';

enum GamePhase { LOBBY, ROLES, NIGHT_WOLVES, NIGHT_WITCH, MORNING, VOTE, RESOLVE, CHECK_END, END }
GamePhase phaseFromStr(String s) => GamePhase.values.firstWhere((e) => describeEnum(e) == s);

enum Role { WOLF, WITCH, VILLAGER }
Role roleFromStr(String s) => Role.values.firstWhere((e) => describeEnum(e) == s);

class LobbyGameInfo {
  final String id;
  final int players;
  final int slots;
  final int maxPlayers;
  LobbyGameInfo({required this.id, required this.players, required this.slots, required this.maxPlayers});
  factory LobbyGameInfo.fromJson(Map<String, dynamic> j) =>
      LobbyGameInfo(id: j['id'], players: j['players'], slots: j['slots'], maxPlayers: j['maxPlayers']);
}

class PlayerView {
  final String id;
  final bool connected;
  final bool alive;
  const PlayerView({required this.id, required this.connected, required this.alive});
}

class Lite {
  final String id;
  const Lite({required this.id});
}

class WitchWake {
  final String? attacked;
  final bool healAvailable;
  final bool poisonAvailable;
  final List<Lite> alive;
  const WitchWake({this.attacked, required this.healAvailable, required this.poisonAvailable, required this.alive});
}

class DayRecap {
  final List<(String playerId, String role)> deaths;
  const DayRecap({required this.deaths});
}

class VoteResult {
  final String? eliminatedId;
  final String? role;
  final Map<String, int> tally;
  const VoteResult({required this.eliminatedId, required this.role, required this.tally});
}

class GameModel {
  final String serverUrl;
  final bool socketConnected;
  final List<LobbyGameInfo> lobby;
  final String? gameId;
  final String? playerId; // also your nickname
  final Role? role;
  final GamePhase phase;
  final int round;
  final List<PlayerView> players;
  final int? deadlineMs;

  // transient payloads
  final List<Lite> wolvesTargets;
  final String? wolvesLockedTargetId;
  final int confirmationsRemaining;

  final WitchWake? witchWake;
  final DayRecap? recap;
  final List<Lite> voteAlive;
  final VoteResult? lastVote;
  final String? winner; // 'WOLVES' | 'VILLAGE'

  final bool vibrations;

  const GameModel({
    required this.serverUrl,
    required this.socketConnected,
    required this.lobby,
    required this.gameId,
    required this.playerId,
    required this.role,
    required this.phase,
    required this.round,
    required this.players,
    required this.deadlineMs,
    required this.wolvesTargets,
    required this.wolvesLockedTargetId,
    required this.confirmationsRemaining,
    required this.witchWake,
    required this.recap,
    required this.voteAlive,
    required this.lastVote,
    required this.winner,
    required this.vibrations,
  });

  factory GameModel.initial() => const GameModel(
        serverUrl: 'http://localhost:3000',
        socketConnected: false,
        lobby: [],
        gameId: null,
        playerId: null,
        role: null,
        phase: GamePhase.LOBBY,
        round: 0,
        players: [],
        deadlineMs: null,
        wolvesTargets: [],
        wolvesLockedTargetId: null,
        confirmationsRemaining: 0,
        witchWake: null,
        recap: null,
        voteAlive: [],
        lastVote: null,
        winner: null,
        vibrations: true,
      );

  GameModel copy({
    String? serverUrl,
    bool? socketConnected,
    List<LobbyGameInfo>? lobby,
    String? gameId,
    String? playerId,
    Role? role,
    GamePhase? phase,
    int? round,
    List<PlayerView>? players,
    int? deadlineMs,
    List<Lite>? wolvesTargets,
    String? wolvesLockedTargetId,
    int? confirmationsRemaining,
    WitchWake? witchWake,
    DayRecap? recap,
    List<Lite>? voteAlive,
    VoteResult? lastVote,
    String? winner,
    bool? vibrations,
  }) {
    return GameModel(
      serverUrl: serverUrl ?? this.serverUrl,
      socketConnected: socketConnected ?? this.socketConnected,
      lobby: lobby ?? this.lobby,
      gameId: gameId ?? this.gameId,
      playerId: playerId ?? this.playerId,
      role: role ?? this.role,
      phase: phase ?? this.phase,
      round: round ?? this.round,
      players: players ?? this.players,
      deadlineMs: deadlineMs ?? this.deadlineMs,
      wolvesTargets: wolvesTargets ?? this.wolvesTargets,
      wolvesLockedTargetId: wolvesLockedTargetId ?? this.wolvesLockedTargetId,
      confirmationsRemaining: confirmationsRemaining ?? this.confirmationsRemaining,
      witchWake: witchWake ?? this.witchWake,
      recap: recap ?? this.recap,
      voteAlive: voteAlive ?? this.voteAlive,
      lastVote: lastVote ?? this.lastVote,
      winner: winner ?? this.winner,
      vibrations: vibrations ?? this.vibrations,
    );
  }
}
