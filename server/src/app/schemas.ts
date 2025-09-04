import { z } from 'zod';

export const zNickname = z.string().min(1).max(20);
export const zGameId = z.string().regex(/^[A-Z]{3}\d$/);

export const CreateGameSchema = z.object({
  nickname: zNickname,
  playerCount: z.number().int().min(3).max(4),
  wolves: z.number().int().min(1).max(2)
}).refine(d => d.wolves <= d.playerCount - 1, { message: 'too_many_wolves' });

export const JoinGameSchema = z.object({
  gameId: zGameId,
  nickname: zNickname
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

export const DayAckSchema = z.object({});

export const VoteCastSchema = z.object({
  targetId: zNickname
});
