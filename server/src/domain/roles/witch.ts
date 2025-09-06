import { bus } from '../events.js';

// La sorcière peut empoisonner une cible pendant la nuit
bus.on('NightAction', ({ game, deaths }) => {
  if (game.night.poisoned) deaths.add(game.night.poisoned);
});

export default {};
