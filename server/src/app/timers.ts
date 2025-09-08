// Durées (en ms) utilisées pour chaque phase et contrôle serveur.
// Les valeurs peuvent être partiellement surchargées via server/timer.config.json.
import fs from 'fs';
import path from 'path';

export type TimerConfig = Partial<{
  // Fenêtre aléatoire entre la fin d'une phase et le réveil suivant
  NEXT_WAKE_DELAY_MIN_MS: number;
  NEXT_WAKE_DELAY_MAX_MS: number;
  // Compte à rebours avant le début de la partie (côté client peut l'utiliser)
  COUNTDOWN_SECONDS: number;
  // Durée d'appui (ms) avant de révéler le rôle en maintenant le badge
  TIME_PRESS_BEFOR_REVEAL_ROLE: number;
  // Overrides facultatifs des durées par phase
  CUPID_MS: number;
  LOVERS_MS: number;
  WOLVES_MS: number;
  WITCH_MS: number;
  HUNTER_MS: number;
  MORNING_MS: number;
  VOTE_MS: number;
  CRITICAL_DISCONNECT_MS: number;
}>;

const defaultConfig: Required<TimerConfig> = {
  NEXT_WAKE_DELAY_MIN_MS: 5_000,
  NEXT_WAKE_DELAY_MAX_MS: 20_000,
  COUNTDOWN_SECONDS: 10,
  TIME_PRESS_BEFOR_REVEAL_ROLE: 700,
  CUPID_MS: 80_000,
  LOVERS_MS: 80_000,
  WOLVES_MS: 80_000,
  WITCH_MS: 80_000,
  HUNTER_MS: 80_000,
  MORNING_MS: 20_000,
  VOTE_MS: 80_000,
  CRITICAL_DISCONNECT_MS: 30_000,
};

function loadConfig(): Required<TimerConfig> {
  try {
    // Cherche à la racine du dossier serveur
    const candidates = [
      path.resolve(process.cwd(), 'timer.config.json'),
      path.resolve(process.cwd(), 'server', 'timer.config.json'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf8');
        const json = JSON.parse(raw) as TimerConfig;
        return { ...defaultConfig, ...json };
      }
    }
  } catch {
    // ignore and use defaults
  }
  return defaultConfig;
}

export const CONFIG = loadConfig();

export const DURATION = {
  CUPID_MS: CONFIG.CUPID_MS,
  LOVERS_MS: CONFIG.LOVERS_MS,
  WOLVES_MS: CONFIG.WOLVES_MS,
  WITCH_MS: CONFIG.WITCH_MS,
  HUNTER_MS: CONFIG.HUNTER_MS,
  MORNING_MS: CONFIG.MORNING_MS,
  VOTE_MS: CONFIG.VOTE_MS,
  CRITICAL_DISCONNECT_MS: CONFIG.CRITICAL_DISCONNECT_MS,
} as const;

export function randomNextWakeMs(): number {
  const min = Math.max(0, CONFIG.NEXT_WAKE_DELAY_MIN_MS);
  const max = Math.max(min, CONFIG.NEXT_WAKE_DELAY_MAX_MS);
  return Math.floor(min + Math.random() * (max - min));
}
