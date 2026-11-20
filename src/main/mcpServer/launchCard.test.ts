import { describe, expect, it } from 'vitest';
import { needsLaunchCard } from './launchCard';
import type { CreatorFacts } from './launchCard';

const HUMAN: CreatorFacts = { isTaskRun: false, creatorChain: [], ultracode: false };

describe('needsLaunchCard', () => {
  it('needsLaunchCard_conModeloYEsfuerzo_false', () => {
    // Arrange
    const request = { requested: { model: 'haiku', effort: 'low' }, creator: HUMAN };
    // Act
    const result = needsLaunchCard(request);
    // Assert
    expect(result).toBe(false);
  });
  it('needsLaunchCard_sinEsfuerzo_true', () => {
    const request = { requested: { model: 'haiku' }, creator: HUMAN };
    const result = needsLaunchCard(request);
    expect(result).toBe(true);
  });
  it('needsLaunchCard_sinModelo_true', () => {
    const request = { requested: { effort: 'low' }, creator: HUMAN };
    const result = needsLaunchCard(request);
    expect(result).toBe(true);
  });
  it('needsLaunchCard_sinNada_true', () => {
    const request = { requested: {}, creator: HUMAN };
    const result = needsLaunchCard(request);
    expect(result).toBe(true);
  });
  it('needsLaunchCard_creadoraTareaProgramada_false', () => {
    const request = { requested: {}, creator: { ...HUMAN, isTaskRun: true } };
    const result = needsLaunchCard(request);
    expect(result).toBe(false);
  });
  it('needsLaunchCard_creadoraDelegada_false', () => {
    const request = { requested: {}, creator: { ...HUMAN, creatorChain: ['abuela'] } };
    const result = needsLaunchCard(request);
    expect(result).toBe(false);
  });
  it('needsLaunchCard_creadoraUltracode_false', () => {
    const request = { requested: {}, creator: { ...HUMAN, ultracode: true } };
    const result = needsLaunchCard(request);
    expect(result).toBe(false);
  });
  it('needsLaunchCard_sinCreadora_false', () => {
    const request = { requested: {}, creator: null };
    const result = needsLaunchCard(request);
    expect(result).toBe(false);
  });
});
