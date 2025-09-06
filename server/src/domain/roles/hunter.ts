import { bus } from '../events.js';
import { alivePlayers } from '../rules.js';

// Enregistre le comportement du chasseur lors de la résolution des morts
bus.on('ResolvePhase', async ({ game, victim, queue, hunterShots, askHunter }) => {
  if (game.roles[victim] !== 'HUNTER' || !askHunter) return;
  const alive = alivePlayers(game).filter(pid => pid !== victim);
  const wolves = alive.filter(pid => game.roles[pid] === 'WOLF');
  const nonWolves = alive.length - wolves.length;
  // si seuls des loups restent en vie et qu'il y en a plus d'un,
  // le tir du chasseur ne peut pas changer l'issue de la partie
  if (nonWolves === 0 && wolves.length > 1) return;
  const target = await Promise.resolve(askHunter(victim, alive));
  if (target && game.alive.has(target)) {
    queue.push(target);
    hunterShots.push({ hunterId: victim, targetId: target });
  }
});

export default {};
