// -----------------------------------------------------------------------------
// Application Flutter du jeu Loup-Garou.
//
// Organisation :
// - "state/" contient la logique et les modèles de données exposés via Riverpod.
// - "services/" regroupe les accès externes (ici la couche Socket.IO).
// - "views/" rassemble les écrans représentant chaque phase du jeu.
// -----------------------------------------------------------------------------

// NOTE MISE A JOUR (2025-09-12)
// Pendant les transitions globales ("Fermez les yeux"), on ne veut plus
// d'overlay sombre avec un chronomètre. Désormais, quand le serveur indique
// `closingEyes=true`, le routeur principal affiche un écran minimaliste avec
// uniquement le texte « Fermez les yeux » (sans timer). Cela garantit la
// même expérience sobre pour tous les joueurs et évite les effets de bord
// liés aux overlays.
// Les timers restent visibles dans les écrans de rôle (loups, sorcière, vote…).

import 'dart:developer';
import 'dart:io';
import 'dart:ui' as ui show Offset; // for explicit Offset
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'state/game_provider.dart';
import 'package:window_manager/window_manager.dart';
import 'package:flutter/foundation.dart';
import 'views/connect_screen.dart';
import 'views/countdown_screen.dart';
import 'views/night_wolves_screen.dart';
import 'views/night_witch_screen.dart';
import 'views/night_cupid_screen.dart';
import 'views/night_lovers_screen.dart';
import 'views/night/seer_view.dart';
import 'views/night/thief_view.dart';
import 'views/morning_screen.dart';
import 'views/vote_screen.dart';
import 'views/day_recap_screen.dart';
import 'views/end_screen.dart';
import 'views/dead_screen.dart';
import 'views/hunter_screen.dart';
import 'views/role_screen.dart';
import 'state/models.dart';
import 'views/widgets/player_badge.dart';

// Point d'entrée de l'application Flutter.
// Initialise les widgets puis démarre l'application
// sous un `ProviderScope` pour activer Riverpod.
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  if (!kIsWeb && Platform.isWindows) {
    try {
      // Defer showing until we set size/position
      await windowManager.ensureInitialized();
      final env = Platform.environment;
      // Read desired size/position from environment (set by launcher script)
      final w = int.tryParse(env['WINDOW_W'] ?? '') ?? 0;
      final h = int.tryParse(env['WINDOW_H'] ?? '') ?? 0;
      final x = int.tryParse(env['WINDOW_X'] ?? '') ?? 0;
      final y = int.tryParse(env['WINDOW_Y'] ?? '') ?? 0;
      final hasSize = w > 0 && h > 0;
      final hasPos = env.containsKey('WINDOW_X') && env.containsKey('WINDOW_Y');

      // Convert requested physical pixels to logical size using the current view's devicePixelRatio
      double scale = 1.0;
      try {
        final views = WidgetsBinding.instance.platformDispatcher.views;
        if (views.isNotEmpty) {
          scale = views.first.devicePixelRatio;
        }
      } catch (_) {}
      final lw = hasSize ? (w.toDouble() / (scale <= 0 ? 1.0 : scale)) : null;
      final lh = hasSize ? (h.toDouble() / (scale <= 0 ? 1.0 : scale)) : null;

      final opts = WindowOptions(
        size: (lw != null && lh != null) ? Size(lw, lh) : null,
        center: !(hasPos),
      );
      await windowManager.waitUntilReadyToShow(opts, () async {
        if (hasSize && lw != null && lh != null) {
          final logicalSize = Size(lw, lh);
          await windowManager.setSize(logicalSize);
          await windowManager.setMinimumSize(logicalSize);
          await windowManager.setMaximumSize(logicalSize);
        }
        if (hasPos) {
          await windowManager.setPosition(ui.Offset(x.toDouble(), y.toDouble()));
        }
        await windowManager.show();
        await windowManager.focus();
      });
    } catch (e, st) {
      log('window init error: $e', stackTrace: st);
    }
  }
  runApp(const ProviderScope(child: App()));
}

/// Widget racine de l'application.
/// Il configure le thème et prépare la navigation
/// en fonction de l'état global du jeu exposé par Riverpod.
class App extends ConsumerWidget {
  const App({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    ref.watch(gameProvider);
    return MaterialApp(
      title: 'Loup-Garou',
      theme: ThemeData(useMaterial3: true, brightness: Brightness.light),
      darkTheme: ThemeData(useMaterial3: true, brightness: Brightness.dark),
      // Injecte un overlay global pour afficher le pseudo du joueur
      // sur tous les écrans lorsqu'une partie est en cours.
      builder: (context, child) => _WithGlobalOverlay(child: child),
      home: _HomeRouter(),
    );
  }
}

class _HomeRouter extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(gameProvider);
    // MISE A JOUR 2025-09-12
    // Contexte produit : durant les "pauses" du jeu (transitions de phase),
    // tous les joueurs doivent simplement voir le texte « Fermez les yeux »,
    // sans overlay ni compte à rebours.
    // Choix technique : gérer `closingEyes` ici, dans le routeur, pour rendre
    // un écran neutre (SleepingPlaceholder) et éviter toute superposition.
    // Avantages :
    // - Pas de superposition complexe : pas de fond noir bloquant ni widgets
    //   cliquables.
    // - Pas de chronomètre : l'affichage reste calme et identique pour tous.
    // - Responsabilités claires : le routeur choisit l'écran à afficher ;
    //   l'enveloppe globale (_WithGlobalOverlay) ne gère plus ce cas.
    final youRole = s.role;
    final phase = s.phase;
    final nowMs = DateTime.now().millisecondsSinceEpoch;
    final me = s.players.firstWhere(
        (p) => p.id == s.playerId,
        orElse: () => const PlayerView(id: '', connected: true, alive: true));

    // Toujours afficher l'écran de fin lorsque la partie est terminée,
    // même si le joueur local est mort.
    if (phase == GamePhase.END) return const EndScreen();

    // Si la révélation des rôles vient d'être déclenchée, forcer l'affichage
    // du compte à rebours local, puis de l'écran de rôle même si le serveur
    // est déjà passé à la phase suivante.
    if (s.roleRevealUntilMs != null) {
      if (nowMs <= s.roleRevealUntilMs!) {
        return const CountdownScreen();
      }
      return const RoleScreen();
    }

    // Si le serveur nous envoie une liste de cibles pour le tir du chasseur,
    // afficher immédiatement l'écran dédié, même si l'on est déjà mort.
    // On vérifie explicitement que le rôle courant est bien HUNTER pour ne
    // pas afficher cet écran à un joueur mal synchronisé.
    if (youRole == Role.HUNTER && s.hunterTargets.isNotEmpty) {
      return const HunterScreen();
    }

    // (géré plus haut pour éviter l'écran « Fermez les yeux » sur les morts)

    // IMPORTANT: Les joueurs morts ne doivent pas voir l'écran « Fermez les yeux »
    // pendant les transitions globales. On gère donc leur cas avant `closingEyes`.
    // Ils restent sur l'écran des défunts (sauf ACK de résolution de vote).
    if (!me.alive) {
      final isResolve = phase == GamePhase.RESOLVE;
      final you = s.playerId;
      final eliminated = s.lastVote?.eliminatedId;
      final youMustAck = isResolve && you != null && eliminated == you;
      if (!youMustAck) {
        return const DeadScreen();
      }
    }

    // Pendant les transitions globales (closingEyes), afficher un écran simple
    // dans le flux principal plutôt qu'un overlay — uniquement pour les vivants.
    if (s.closingEyes) {
      return const SleepingPlaceholder(title: ' ', subtitle: 'Fermez les yeux');
    }

    // Aucune partie jointe: afficher l'écran de connexion.
    if (s.gameId == null) return const ConnectScreen();

    // Route vers l'écran approprié selon la phase de jeu courante.
    switch (phase) {
      case GamePhase.ROLES:
        return const RoleScreen();
      case GamePhase.NIGHT_CUPID:
        if (youRole == Role.CUPID) return const NightCupidScreen();
        return const SleepingPlaceholder(title: 'Nuit', subtitle: 'Fermez les yeux');
      case GamePhase.NIGHT_THIEF:
        if (youRole == Role.THIEF) return const ThiefView();
        return const SleepingPlaceholder(title: 'Nuit', subtitle: 'Fermez les yeux');
      case GamePhase.NIGHT_LOVERS:
        if (s.loverPartnerId != null) return const NightLoversScreen();
        return const SleepingPlaceholder(title: 'Nuit', subtitle: 'Fermez les yeux');
      case GamePhase.NIGHT_SEER:
        if (youRole == Role.SEER) return const SeerView();
        return const SleepingPlaceholder(title: 'Nuit', subtitle: 'Fermez les yeux');
      case GamePhase.NIGHT_WOLVES:
        if (youRole == Role.WOLF) return const NightWolvesScreen();
        return const SleepingPlaceholder(title: 'Nuit', subtitle: 'Fermez les yeux');
      case GamePhase.NIGHT_WITCH:
        if (youRole == Role.WITCH) return const NightWitchScreen();
        return const SleepingPlaceholder(title: 'Nuit', subtitle: 'Fermez les yeux');
      case GamePhase.MORNING:
        return const MorningScreen();
      case GamePhase.VOTE:
        return const VoteScreen();
      case GamePhase.LOBBY:
        return const WaitingLobby();
      case GamePhase.RESOLVE:
        // Pendant la résolution (après un vote diurne), afficher un écran
        // récapitulatif listant l'élimination et les votes. Cela remplace
        // l'ancien flux qui restait sur l'écran de vote.
        if (s.dayVoteRecap != null) return const DayRecapScreen();
        return const VoteScreen();
      case GamePhase.CHECK_END:
        // Courte phase de vérification des conditions de victoire, avant soit
        // la fin de partie (END), soit le retour à la nuit si personne n'a gagné.
        return const SleepingPlaceholder(title: 'Transition', subtitle: 'Patientez...');
      default:
        return const WaitingLobby();
    }
  }
}

/// Affiche un écran simpliste pendant que le joueur "dort"
/// lors des phases de nuit auxquelles il ne participe pas.
/// MISE A JOUR 2025-09-12: aussi utilisé pendant `closingEyes` pour afficher
/// uniquement « Fermez les yeux » sans chronomètre ni overlay global.
class SleepingPlaceholder extends StatelessWidget {
  final String title;
  final String subtitle;
  const SleepingPlaceholder({super.key, required this.title, required this.subtitle});
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: Center(child: Text(subtitle, style: const TextStyle(fontSize: 20))),
    );
  }
}

/// Salle d'attente affichée avant le début de la partie.
/// Les joueurs connectés y sont listés et l'hôte peut annuler la partie.
class WaitingLobby extends ConsumerWidget {
  const WaitingLobby({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(gameProvider);
    final ctl = ref.read(gameProvider.notifier);
    final isOwner = s.isOwner;
    // Si aucun snapshot n'a été reçu, déclenche une resynchronisation
    if (!s.hasSnapshot && s.gameId != null && s.playerId != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        ctl.ensureSynced();
      });
    }
    return Scaffold(
      appBar: AppBar(title: const Text('Salle d’attente')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            if (!s.hasSnapshot) ...[
              Text('Partie ${s.gameId} • synchronisation...'),
            ] else ...[
              Text('Partie ${s.gameId} • joueurs: ${s.players.where((p) => p.alive).length}/${s.maxPlayers}')
            ],
            const SizedBox(height: 12),
            if (!s.hasSnapshot)
              const Expanded(child: Center(child: CircularProgressIndicator()))
            else
              Expanded(
                child: ListView(
                  children: s.players
                      .map((p) => ListTile(
                            title: Text(p.id),
                            subtitle: Text(p.alive ? 'Vivant' : 'Mort'),
                            trailing: Icon(p.connected ? Icons.wifi : Icons.wifi_off),
                          ))
                      .toList(),
                ),
              ),
            const SizedBox(height: 12),
            ElevatedButton(
              onPressed: () async {
                String? err;
                try {
                  err = await (isOwner ? ctl.cancelGame() : ctl.leaveGame());
                } catch (e, st) {
                  err = e.toString();
                  log('leave/cancel exception: $err', stackTrace: st);
                } finally {
                  if (context.mounted) {
                    if (err != null) {
                      ScaffoldMessenger.of(context)
                          .showSnackBar(SnackBar(backgroundColor: Colors.red, content: Text(err)));
                    }
                    // Pas de navigation nécessaire : le routeur principal
                    // réaffichera automatiquement l'écran de connexion
                    // puisque l'état a été réinitialisé.
                  }
                }
              },
              child: Text(isOwner ? 'Annuler la partie' : 'Quitter la partie'),
            ),
            const SizedBox(height: 12),
            Text('En attente du démarrage automatique à ${s.maxPlayers} joueurs...')
          ],
        ),
      ),
    );
  }
}

/// Enveloppe globale pour ajouter un overlay persistant (ex: pseudo du joueur)
/// au-dessus de toutes les vues de l'application.
///
/// Note (2025-09-12): cet overlay n'affiche plus l'état « Fermez les yeux »
/// des transitions globales. Ce cas est désormais géré par _HomeRouter
/// (rendu principal), afin d'éviter tout chronomètre et simplifier l'UI.
class _WithGlobalOverlay extends ConsumerWidget {
  final Widget? child;
  const _WithGlobalOverlay({this.child});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(gameProvider);
    return Stack(
      children: [
        // Contenu principal (Navigator)
        Positioned.fill(child: child ?? const SizedBox.shrink()),
        // Overlay global (affiché uniquement lorsqu'une partie est rejointe)
        AnimatedOpacity(
          opacity: s.gameId != null ? 1.0 : 0.0,
          duration: const Duration(milliseconds: 150),
          child: const PlayerBadge(),
        ),
        // MISE A JOUR 2025-09-12
        // L'overlay « Fermez les yeux » a été retiré d'ici pour éviter
        // l'effet de superposition + chronomètre. Le rendu de cet état
        // de transition est désormais fait dans _HomeRouter : lorsqu'il
        // détecte `closingEyes==true`, il renvoie un écran simple sans timer.
        // Ainsi, _WithGlobalOverlay reste dédié aux éléments persistants
        // (ex. PlayerBadge) et n'empiète plus sur les transitions.
        // Plus d'overlay pendant les transitions: l'écran principal gère l'affichage.
      ],
    );
  }
}
