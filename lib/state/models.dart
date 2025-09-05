import 'package:flutter/foundation.dart';

/// États successifs possibles de la partie.
enum GamePhase { LOBBY, ROLES, NIGHT_WOLVES, NIGHT_WITCH, MORNING, VOTE, RESOLVE, CHECK_END, END }
GamePhase phaseFromStr(String s) => GamePhase.values.firstWhere((e) => describeEnum(e) == s);

/// Rôles attribués aux joueurs.
enum Role { WOLF, WITCH, HUNTER, VILLAGER }
Role roleFromStr(String s) => Role.values.firstWhere((e) => describeEnum(e) == s);

/// Informations minimales sur une partie disponible dans le lobby.
class LobbyGameInfo {
  final String id;
  final int players;
  final int slots;
  final int maxPlayers;
  LobbyGameInfo({required this.id, required this.players, required this.slots, required this.maxPlayers});
  factory LobbyGameInfo.fromJson(Map<String, dynamic> j) =>
      LobbyGameInfo(id: j['id'], players: j['players'], slots: j['slots'], maxPlayers: j['maxPlayers']);
}

/// Représente un joueur tel que visible par les autres.
class PlayerView {
  final String id;
  final bool connected;
  final bool alive;
  const PlayerView({required this.id, required this.connected, required this.alive});
}

/// Version "allégée" d'un joueur utilisée dans certaines listes.
class Lite {
  final String id;
  const Lite({required this.id});
}

/// Informations envoyées à la sorcière lorsqu'elle se réveille.
class WitchWake {
  final String? attacked;
  final bool healAvailable;
  final bool poisonAvailable;
  final List<Lite> alive;
  const WitchWake({this.attacked, required this.healAvailable, required this.poisonAvailable, required this.alive});
}

/// Récapitulatif des morts de la nuit précédente.
class DayRecap {
  final List<(String playerId, String role)> deaths;
  final List<String> hunterKills;
  const DayRecap({required this.deaths, required this.hunterKills});
}

/// Résultat d'un vote du village.
class VoteResult {
  final String? eliminatedId;
  final String? role;
  final Map<String, int> tally;
  const VoteResult({required this.eliminatedId, required this.role, required this.tally});
}

/// État complet de l'application côté client.
/// Il est exposé via Riverpod et contient toutes les informations
/// nécessaires pour construire l'interface.
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
  final int maxPlayers;

  // transient payloads
  final List<Lite> wolvesTargets;
  final String? wolvesLockedTargetId;
  final int confirmationsRemaining;

  final WitchWake? witchWake;
  final List<Lite> hunterTargets;
  final DayRecap? recap;
  final List<Lite> voteAlive;
  final VoteResult? lastVote;
  final String? winner; // 'WOLVES' | 'VILLAGE'
  final List<(String playerId, Role role)> finalRoles;

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
    required this.maxPlayers,
    required this.wolvesTargets,
    required this.wolvesLockedTargetId,
    required this.confirmationsRemaining,
    required this.witchWake,
    required this.hunterTargets,
    required this.recap,
    required this.voteAlive,
    required this.lastVote,
    required this.winner,
    required this.finalRoles,
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
        finalRoles: const [],
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
    int? maxPlayers,
    List<Lite>? wolvesTargets,
    String? wolvesLockedTargetId,
    int? confirmationsRemaining,
    WitchWake? witchWake,
    List<Lite>? hunterTargets,
    DayRecap? recap,
    List<Lite>? voteAlive,
    VoteResult? lastVote,
    String? winner,
    List<(String playerId, Role role)>? finalRoles,
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
      maxPlayers: maxPlayers ?? this.maxPlayers,
      wolvesTargets: wolvesTargets ?? this.wolvesTargets,
      wolvesLockedTargetId: wolvesLockedTargetId ?? this.wolvesLockedTargetId,
      confirmationsRemaining: confirmationsRemaining ?? this.confirmationsRemaining,
      witchWake: witchWake ?? this.witchWake,
      hunterTargets: hunterTargets ?? this.hunterTargets,
      recap: recap ?? this.recap,
      voteAlive: voteAlive ?? this.voteAlive,
      lastVote: lastVote ?? this.lastVote,
      winner: winner ?? this.winner,
      finalRoles: finalRoles ?? this.finalRoles,
      vibrations: vibrations ?? this.vibrations,
    );
  }
}
