// Modèles de données utilisés par toute l'application.
// Regroupe les énumérations, vues simplifiées et l'état global [GameModel].
// Les énumérations (GamePhase, Role) et leurs convertisseurs sont générés
// automatiquement depuis le serveur dans `state/generated/enums.dart`.
export 'generated/enums.dart';
import 'generated/enums.dart';

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
  final bool ready;
  const PlayerView({required this.id, required this.connected, required this.alive, this.ready = false});
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
  final bool isOwner; // client-side flag for lobby actions
  final bool hasSnapshot; // received at least one game:snapshot
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
  // Liste des joueurs vivants que la voyante peut sonder cette nuit.
  // Elle est envoyée par le serveur au moment du réveil.
  final List<Lite> seerTargets;
  // Journal privé des rôles révélés par la voyante au fil des nuits.
  final List<(String playerId, Role role)> seerLog;
  final List<Lite> cupidTargets;
  final String? loverPartnerId;
  final DayRecap? recap;
  final List<Lite> voteAlive;
  final VoteResult? lastVote;
  // Dernier comptage côté loups en cas d'égalité (revote)
  final Map<String, int>? wolvesLastTally;
  final String? winner; // 'WOLVES' | 'VILLAGE'
  final List<(String playerId, Role role)> finalRoles;

  final bool vibrations;
  // Global transition: tout le monde garde les yeux fermés jusqu'à la deadline
  final bool closingEyes;
  // Indicateur local pour l'écran ROLES: mémorise le clic "Je suis prêt"
  // afin que l'UI reste cohérente même en cas de rebuild avant la
  // synchronisation serveur.
  final bool youReadyLocal;
  // Affiche localement l'écran de compte à rebours de révélation des rôles
  // jusqu'à cette échéance (epoch ms). Permet de garantir l'affichage du
  // compte à rebours même si le serveur change rapidement d'état.
  final int? roleRevealUntilMs;
  // Durée d'appui requise pour révéler le rôle via le badge (ms)
  final int rolePressRevealMs;
  // Ensemble local des joueurs connus comme amoureux (ids). Renseigné lors de
  // l'évènement secret lovers:wake (toi et ton partenaire) et potentiellement
  // complété par heuristique côté UI si les amoureux gagnent (deux survivants).
  final Set<String> loversKnown;

  const GameModel({
    required this.serverUrl,
    required this.socketConnected,
    required this.lobby,
    required this.gameId,
    required this.playerId,
    required this.isOwner,
    required this.hasSnapshot,
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
    required this.seerTargets,
    required this.seerLog,
    required this.cupidTargets,
    required this.loverPartnerId,
    required this.recap,
    required this.voteAlive,
    required this.lastVote,
    required this.wolvesLastTally,
    required this.winner,
    required this.finalRoles,
    required this.vibrations,
    required this.closingEyes,
    required this.youReadyLocal,
    required this.roleRevealUntilMs,
    required this.rolePressRevealMs,
    required this.loversKnown,
  });

  /// État initial utilisé au démarrage de l'application.
  factory GameModel.initial() => const GameModel(
        serverUrl: 'http://localhost:3000',
        socketConnected: false,
        lobby: [],
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
        cupidTargets: [],
        loverPartnerId: null,
        recap: null,
        voteAlive: [],
        lastVote: null,
      wolvesLastTally: null,
        winner: null,
      finalRoles: [],
      vibrations: true,
      closingEyes: false,
      youReadyLocal: false,
      roleRevealUntilMs: null,
      rolePressRevealMs: 700,
      loversKnown: <String>{},
    );

  static const _unset = Object();

  /// Crée une copie de ce modèle en remplaçant uniquement les champs fournis.
  /// Les paramètres utilisent une valeur sentinelle pour permettre de passer `null`.
  GameModel copy({
    String? serverUrl,
    bool? socketConnected,
    List<LobbyGameInfo>? lobby,
    Object? gameId = _unset,
    Object? playerId = _unset,
    bool? isOwner,
    bool? hasSnapshot,
    Object? role = _unset,
    GamePhase? phase,
    int? round,
    List<PlayerView>? players,
    Object? deadlineMs = _unset,
    int? maxPlayers,
    List<Lite>? wolvesTargets,
    Object? wolvesLockedTargetId = _unset,
    int? confirmationsRemaining,
    Object? witchWake = _unset,
    List<Lite>? hunterTargets,
    List<Lite>? seerTargets,
    List<(String playerId, Role role)>? seerLog,
    List<Lite>? cupidTargets,
    Object? loverPartnerId = _unset,
    Object? recap = _unset,
    List<Lite>? voteAlive,
    Object? lastVote = _unset,
    Object? wolvesLastTally = _unset,
    Object? winner = _unset,
    List<(String playerId, Role role)>? finalRoles,
    bool? vibrations,
    bool? closingEyes,
    bool? youReadyLocal,
    Object? roleRevealUntilMs = _unset,
    int? rolePressRevealMs,
    Set<String>? loversKnown,
  }) {
    return GameModel(
      serverUrl: serverUrl ?? this.serverUrl,
      socketConnected: socketConnected ?? this.socketConnected,
      lobby: lobby ?? this.lobby,
      gameId: identical(gameId, _unset) ? this.gameId : gameId as String?,
      playerId: identical(playerId, _unset) ? this.playerId : playerId as String?,
      isOwner: isOwner ?? this.isOwner,
      hasSnapshot: hasSnapshot ?? this.hasSnapshot,
      role: identical(role, _unset) ? this.role : role as Role?,
      phase: phase ?? this.phase,
      round: round ?? this.round,
      players: players ?? this.players,
      deadlineMs: identical(deadlineMs, _unset) ? this.deadlineMs : deadlineMs as int?,
      maxPlayers: maxPlayers ?? this.maxPlayers,
      wolvesTargets: wolvesTargets ?? this.wolvesTargets,
      wolvesLockedTargetId: identical(wolvesLockedTargetId, _unset)
          ? this.wolvesLockedTargetId
          : wolvesLockedTargetId as String?,
      confirmationsRemaining: confirmationsRemaining ?? this.confirmationsRemaining,
      witchWake: identical(witchWake, _unset) ? this.witchWake : witchWake as WitchWake?,
      hunterTargets: hunterTargets ?? this.hunterTargets,
      seerTargets: seerTargets ?? this.seerTargets,
      seerLog: seerLog ?? this.seerLog,
      cupidTargets: cupidTargets ?? this.cupidTargets,
      loverPartnerId: identical(loverPartnerId, _unset) ? this.loverPartnerId : loverPartnerId as String?,
      recap: identical(recap, _unset) ? this.recap : recap as DayRecap?,
      voteAlive: voteAlive ?? this.voteAlive,
      lastVote: identical(lastVote, _unset) ? this.lastVote : lastVote as VoteResult?,
      wolvesLastTally: identical(wolvesLastTally, _unset) ? this.wolvesLastTally : wolvesLastTally as Map<String,int>?,
      winner: identical(winner, _unset) ? this.winner : winner as String?,
      finalRoles: finalRoles ?? this.finalRoles,
      vibrations: vibrations ?? this.vibrations,
      closingEyes: closingEyes ?? this.closingEyes,
      youReadyLocal: youReadyLocal ?? this.youReadyLocal,
      roleRevealUntilMs: identical(roleRevealUntilMs, _unset)
          ? this.roleRevealUntilMs
          : roleRevealUntilMs as int?,
      rolePressRevealMs: rolePressRevealMs ?? this.rolePressRevealMs,
      loversKnown: loversKnown ?? this.loversKnown,
    );
  }
}
