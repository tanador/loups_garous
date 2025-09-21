// Durées (en ms) utilisées pour chaque phase et contrôle serveur.
// Les valeurs peuvent être partiellement surchargées via server/timer.config.json.
import fs from 'fs';
import path from 'path';
import { logger } from '../logger.js';

export type TimerConfig = Partial<{
  // Fenêtre aléatoire entre la fin d'une phase et le réveil suivant
  NEXT_WAKE_DELAY_MIN_MS: number;
  NEXT_WAKE_DELAY_MAX_MS: number;
  // Compte à rebours avant le début de la partie (côté client peut l'utiliser)
  COUNTDOWN_SECONDS: number;
  // Durée d'appui (ms) avant de révéler le rôle en maintenant le badge
  TIME_PRESS_BEFOR_REVEAL_ROLE: number;
  // Paramètres des vibrations client configurables côté serveur
  NOMBRE_DE_VIBRATIONS: number;
  TEMPS_CHAQUE_VIBRATION: number;
  PAUSE_ENTRE_VIBRATION: number;
  FORCE_VIBRATION: number;
  // Overrides facultatifs des durées par phase
  CUPID_MS: number;
  LOVERS_MS: number;
  SEER_MS: number;
  WOLVES_MS: number;
  WITCH_MS: number;
  THIEF_MS: number;
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
  NOMBRE_DE_VIBRATIONS: 1,
  TEMPS_CHAQUE_VIBRATION: 5_000,
  PAUSE_ENTRE_VIBRATION: 0,
  FORCE_VIBRATION: 128,
  CUPID_MS: 80_000,
  LOVERS_MS: 80_000,
  SEER_MS: 80_000,
  WOLVES_MS: 80_000,
  WITCH_MS: 80_000,
  // Night 0: time window for the THIEF to decide (keep/swap)
  THIEF_MS: 60_000,
  HUNTER_MS: 80_000,
  MORNING_MS: 20_000,
  VOTE_MS: 80_000,
  CRITICAL_DISCONNECT_MS: 30_000,
};

const CONFIG_CANDIDATES = [
  path.resolve(process.cwd(), 'timer.config.json'),
  path.resolve(process.cwd(), 'server', 'timer.config.json'),
];

type LoadedConfig = {
  config: Required<TimerConfig>;
  path: string | null;
  raw: string | null;
};

const readConfig = (): LoadedConfig | null => {
  for (const candidate of CONFIG_CANDIDATES) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const raw = fs.readFileSync(candidate, 'utf8');
      const json = JSON.parse(raw) as TimerConfig;
      return { config: { ...defaultConfig, ...json }, path: candidate, raw };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error({ event: 'timer.config.parse_error', path: candidate, error });
      return null;
    }
  }
  return { config: { ...defaultConfig }, path: null, raw: null };
};

const initialLoad = readConfig() ?? { config: { ...defaultConfig }, path: null, raw: null };

export const CONFIG: Required<TimerConfig> = { ...initialLoad.config };

type DurationShape = {
  CUPID_MS: number;
  LOVERS_MS: number;
  SEER_MS: number;
  WOLVES_MS: number;
  WITCH_MS: number;
  THIEF_MS: number;
  HUNTER_MS: number;
  MORNING_MS: number;
  VOTE_MS: number;
  CRITICAL_DISCONNECT_MS: number;
};

const createDuration = (cfg: Required<TimerConfig>): DurationShape => ({
  CUPID_MS: cfg.CUPID_MS,
  LOVERS_MS: cfg.LOVERS_MS,
  SEER_MS: cfg.SEER_MS,
  WOLVES_MS: cfg.WOLVES_MS,
  WITCH_MS: cfg.WITCH_MS,
  THIEF_MS: cfg.THIEF_MS,
  HUNTER_MS: cfg.HUNTER_MS,
  MORNING_MS: cfg.MORNING_MS,
  VOTE_MS: cfg.VOTE_MS,
  CRITICAL_DISCONNECT_MS: cfg.CRITICAL_DISCONNECT_MS,
});

const applyDuration = (target: DurationShape, cfg: Required<TimerConfig>) => {
  target.CUPID_MS = cfg.CUPID_MS;
  target.LOVERS_MS = cfg.LOVERS_MS;
  target.SEER_MS = cfg.SEER_MS;
  target.WOLVES_MS = cfg.WOLVES_MS;
  target.WITCH_MS = cfg.WITCH_MS;
  target.THIEF_MS = cfg.THIEF_MS;
  target.HUNTER_MS = cfg.HUNTER_MS;
  target.MORNING_MS = cfg.MORNING_MS;
  target.VOTE_MS = cfg.VOTE_MS;
  target.CRITICAL_DISCONNECT_MS = cfg.CRITICAL_DISCONNECT_MS;
};

export const DURATION = createDuration(CONFIG);

const clampInt = (value: number, min: number, max: number): number => {
  const int = Number.isFinite(value) ? Math.trunc(value) : min;
  if (int < min) return min;
  if (int > max) return max;
  return int;
};

type VibrationShape = {
  count: number;
  pulseMs: number;
  pauseMs: number;
  amplitude: number;
};

const createVibration = (cfg: Required<TimerConfig>): VibrationShape => ({
  count: clampInt(cfg.NOMBRE_DE_VIBRATIONS, 0, 200),
  pulseMs: clampInt(cfg.TEMPS_CHAQUE_VIBRATION, 0, 60_000),
  pauseMs: clampInt(cfg.PAUSE_ENTRE_VIBRATION, 0, 60_000),
  amplitude: clampInt(cfg.FORCE_VIBRATION, 1, 255),
});

const applyVibration = (target: VibrationShape, cfg: Required<TimerConfig>) => {
  target.count = clampInt(cfg.NOMBRE_DE_VIBRATIONS, 0, 200);
  target.pulseMs = clampInt(cfg.TEMPS_CHAQUE_VIBRATION, 0, 60_000);
  target.pauseMs = clampInt(cfg.PAUSE_ENTRE_VIBRATION, 0, 60_000);
  target.amplitude = clampInt(cfg.FORCE_VIBRATION, 1, 255);
};

export const VIBRATION = createVibration(CONFIG);

let cachedPath = initialLoad.path;
let cachedRaw = initialLoad.raw;

let reloadTimer: NodeJS.Timeout | null = null;

const reloadConfig = () => {
  const loaded = readConfig();
  if (!loaded) return;
  if (loaded.path === cachedPath && loaded.raw === cachedRaw) return;
  cachedPath = loaded.path;
  cachedRaw = loaded.raw;
  Object.assign(CONFIG, loaded.config);
  applyDuration(DURATION, loaded.config);
  applyVibration(VIBRATION, loaded.config);
  logger.info({ event: 'timer.config.reloaded', path: cachedPath ?? 'default' });
};

const scheduleReload = () => {
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    reloadTimer = null;
    reloadConfig();
  }, 50);
};

// Surveille les répertoires contenant le fichier de configuration
// afin de recharger les durées sans redémarrage du serveur.
const filesByDirectory = new Map<string, Set<string>>();
for (const candidate of CONFIG_CANDIDATES) {
  const directory = path.dirname(candidate);
  const filename = path.basename(candidate);
  const names = filesByDirectory.get(directory) ?? new Set<string>();
  names.add(filename);
  filesByDirectory.set(directory, names);
}

for (const [directory, filenames] of filesByDirectory) {
  if (!fs.existsSync(directory)) continue;
  try {
    fs.watch(directory, (eventType, changed) => {
      const name = typeof changed === 'string' ? changed : changed?.toString();
      if (!name || filenames.has(name)) scheduleReload();
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.warn({ event: 'timer.config.watch_failed', directory, error });
  }
}

export function randomNextWakeMs(): number {
  const min = Math.max(0, CONFIG.NEXT_WAKE_DELAY_MIN_MS);
  const max = Math.max(min, CONFIG.NEXT_WAKE_DELAY_MAX_MS);
  return Math.floor(min + Math.random() * (max - min));
}

