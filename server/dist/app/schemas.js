import { z } from 'zod';
export const zNickname = z.string().min(1).max(20);
export const zGameId = z.string().min(1);
export const zPlayerId = z.string().min(1);
export const CreateGameSchema = z.object({
    nickname: zNickname,
    variant: z.enum(['V1', 'V2', 'AUTO']).default('AUTO')
});
export const JoinGameSchema = z.object({
    gameId: zGameId,
    nickname: zNickname
});
export const ResumeSchema = z.object({
    gameId: zGameId,
    playerId: zPlayerId
});
export const ReadySchema = z.object({});
export const WolvesChooseSchema = z.object({
    targetId: zPlayerId
});
export const WitchDecisionSchema = z.object({
    save: z.boolean(),
    poisonTargetId: zPlayerId.optional()
});
export const DayAckSchema = z.object({});
export const VoteCastSchema = z.object({
    targetId: z.union([zPlayerId, z.null()]) // null = abstention
});
//# sourceMappingURL=schemas.js.map