import { z } from 'zod';

// Définition des schémas d'entrée pour valider les données reçues.
export const zNickname = z.string().min(1).max(20);
export const zGameId = z.string().regex(/^[A-Z]{3}\d$/);

// Autorise désormais la création de parties à 3, 4, 5 ou 6 joueurs.
// Note pour contributeur débutant:
// - Le serveur valide ici les entrées Socket.IO. Étendre ce schéma
//   permet immédiatement au client de demander 5/6 joueurs.
// - La répartition des rôles dépend ensuite de roles.config.json.
export const CreateGameSchema = z.object({
  nickname: zNickname,
  // Autorise 3, 4, 5 ou 6 joueurs. La valeur par défaut reste 3 pour la compatibilité.
  maxPlayers: z.union([z.literal(3), z.literal(4), z.literal(5), z.literal(6)]).default(3)
});

export const JoinGameSchema = z.object({
  gameId: zGameId,
  nickname: zNickname
});

export const CancelGameSchema = z.object({
  gameId: zGameId,
  playerId: zNickname,
});

export const LeaveGameSchema = z.object({
  gameId: zGameId,
  playerId: zNickname,
});

export const ResumeSchema = z.object({
  gameId: zGameId,
  playerId: zNickname
});

export const ReadySchema = z.object({});

export const WolvesChooseSchema = z.object({
  targetId: zNickname
});

export const SeerPeekSchema = z.object({
  targetId: zNickname,
});
export const SeerAckSchema = z.object({});

export const CupidChooseSchema = z.object({
  targetA: zNickname,
  targetB: zNickname,
});

export const WitchDecisionSchema = z.object({
  save: z.boolean(),
  poisonTargetId: zNickname.optional()
});

export const HunterShootSchema = z.object({
  targetId: zNickname
});

export const DayAckSchema = z.object({});

export const VoteCastSchema = z.object({
  targetId: zNickname
});

export const VoteCancelSchema = z.object({});
export const LoversAckSchema = z.object({});
// ACK de fin de vote (diurne): aucune donnée utile côté client,
// la présence de l'ACK suffit à débloquer la transition.
export const VoteAckSchema = z.object({});
