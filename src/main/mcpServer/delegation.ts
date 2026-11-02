import { MagePolicyError } from './errors';
export const DEFAULT_MAX_DELEGATION_DEPTH = 3;
export const MAX_DELEGATION_DEPTH = 5;

export function validateDelegation(input: { creatorChain: readonly string[]; callerId?: string; maxDepth?: number }): string[] {
  const { creatorChain, callerId, maxDepth = DEFAULT_MAX_DELEGATION_DEPTH } = input;
  if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > MAX_DELEGATION_DEPTH) {
    throw new MagePolicyError(`delegation_invalid_depth: valor recibido ${maxDepth}`);
  }
  const ancestors = new Set(creatorChain);
  const chain = callerId === undefined ? [] : [...creatorChain, callerId];
  if (ancestors.size !== creatorChain.length || (callerId !== undefined && ancestors.has(callerId))) {
    throw new MagePolicyError(`delegation_cycle: ${[...creatorChain, ...(callerId === undefined ? [] : [callerId])].join('→')}`);
  }
  if (chain.length >= maxDepth) throw new MagePolicyError(`delegation_depth_exceeded: máximo ${maxDepth}, cadena ${chain.join('→')}`);
  return chain;
}
