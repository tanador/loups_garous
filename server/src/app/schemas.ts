import { z } from 'zod';

export const zNickname = z.string().min(1).max(20);
export const zGameId = z.string().regex(/^[A-Z]{3}\d$/);

export const CreateGameSchema = z.object({
  nickname: zNickname,
  maxPlayers: z.union([z.literal(3), z.literal(4)]).default(3)
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
