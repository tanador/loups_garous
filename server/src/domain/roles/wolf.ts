import { bus } from '../events.js';

// Les loups ajoutent leur cible aux morts de la nuit
bus.on('NightAction', ({ game, deaths }) => {
  const { attacked, saved } = game.night;
  if (attacked && attacked !== saved) deaths.add(attacked);
});

export default {};
