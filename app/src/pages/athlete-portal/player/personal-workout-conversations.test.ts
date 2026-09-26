import { describe, expect, it, vi } from 'vitest';
import { checkedCoachPersonalProposal, checkedPersonalConversation, checkedPersonalProposal, orderedPersonalMessages, personalProposalWithPublication, personalPublishParams, personalRefinementParams, publishedPersonalWorkoutId, readPersonalConversation, restorePersonalSelection } from './personal-workout-conversations';

const expiry = new Date('2026-10-01T12:00:00Z');
const proposal = () => ({ schemaVersion: 1, proposalId: 'proposal_2', conversationId: 'conversation_1', proposalRevision: 2,
  baseProposalId: 'proposal_1', createdByUid: 'athlete_1', expiresAt: expiry, check: { ok: true }, requestedMinutes: 15,
  expectedRevision: 0, expectedScheduleRevision: 4, scheduledDate: '2026-09-30', timezone: 'America/Los_Angeles',
  intake: { age: 15, equipment: ['ball'], setting: 'solo', painFlag: false },
  workout: { title: 'Close control', budgetMinutes: 15, blocks: [{ blockId: 'b1', drillId: 'BMA-001', sets: 3, reps: 60 }] } });
const conversation = () => ({ id: 'conversation_1', conversationId: 'conversation_1', capability: 'generate_personal_workout', createdByUid: 'athlete_1', latestProposalId: 'proposal_2', proposalRevision: 2 });

describe('personal conversation recovery', () => {
  it('opens the canonical Coach proposal without requiring a redundant playerId field', () => {
    expect(checkedCoachPersonalProposal(proposal(), 'proposal_2', 'athlete_1', 'player_1', 'conversation_1')).toEqual(proposal());
  });
  it('rejects Coach previews with a different owner, conversation, explicit player scope, or invalid prescription', () => {
    for (const value of [null, { ...proposal(), createdByUid: 'another' }, { ...proposal(), conversationId: 'other' },
      { ...proposal(), playerId: 'other' }, { ...proposal(), check: { ok: false } }]) {
      expect(() => checkedCoachPersonalProposal(value, 'proposal_2', 'athlete_1', 'player_1', 'conversation_1')).toThrow();
    }
  });
  it('migrates an older cached proposal into IDs only, never trusting its workout or checks', () => {
    expect(restorePersonalSelection({ uid: 'athlete_1', playerId: 'player_1', result: { ...proposal(), workout: { title: 'Tampered cache' } } }, 'athlete_1', 'player_1'))
      .toEqual({ schemaVersion: 1, uid: 'athlete_1', playerId: 'player_1', proposalId: 'proposal_2', conversationId: 'conversation_1' });
    expect(restorePersonalSelection({ uid: 'athlete_1', playerId: 'player_1', proposalId: '../another-player' }, 'athlete_1', 'player_1')).toBeNull();
  });
  it('does not reuse another account or player selection', () => {
    const selected = { uid: 'athlete_1', playerId: 'player_1', proposalId: 'proposal_2' };
    expect(restorePersonalSelection(selected, 'athlete_2', 'player_1')).toBeNull();
    expect(restorePersonalSelection(selected, 'athlete_1', 'player_2')).toBeNull();
  });
  it('opens the current server proposal and complete ordered conversation without generating a workout', async () => {
    const port = { conversation: vi.fn(async () => conversation()), proposal: vi.fn(async () => proposal()), messages: vi.fn(async () => [
      { role: 'assistant', content: 'Your revised workout', sequence: 4, proposalId: 'proposal_2' },
      { role: 'user', content: 'Remove the wall drill', sequence: 3 },
      { role: 'user', content: 'I have 15 minutes', sequence: 1 },
      { role: 'assistant', content: 'Your first workout', sequence: 2, proposalId: 'proposal_1' },
    ]) };
    const result = await readPersonalConversation(port, 'conversation_1', 'athlete_1');
    expect(port.proposal).toHaveBeenCalledExactlyOnceWith('proposal_2');
    expect(result.proposal.workout.budgetMinutes).toBe(15);
    expect(result.messages.map(row => row.sequence)).toEqual([1, 2, 3, 4]);
  });
  it('refuses an owner or capability mismatch before reading the private transcript', async () => {
    const port = { conversation: vi.fn(async () => ({ ...conversation(), createdByUid: 'another' })), proposal: vi.fn(), messages: vi.fn() };
    await expect(readPersonalConversation(port, 'conversation_1', 'athlete_1')).rejects.toThrow('unavailable for this account');
    expect(port.messages).not.toHaveBeenCalled(); expect(port.proposal).not.toHaveBeenCalled();
    expect(() => checkedPersonalConversation({ ...conversation(), capability: 'pose_chat' }, 'conversation_1', 'athlete_1')).toThrow();
  });
  it('does not accept a proposal from an older revision, another conversation, or a failed check', () => {
    for (const value of [{ ...proposal(), proposalRevision: 1 }, { ...proposal(), conversationId: 'other' }, { ...proposal(), check: { ok: false } }, { ...proposal(), createdByUid: 'another' }]) {
      expect(() => checkedPersonalProposal(value, 'proposal_2', 'athlete_1', conversation())).toThrow();
    }
  });
  it('allows an expired server draft to be reopened for refreshing, but never published', () => {
    expect(checkedPersonalProposal(proposal(), 'proposal_2', 'athlete_1', conversation())).toEqual(proposal());
    expect(() => personalPublishParams(proposal(), conversation(), expiry.getTime())).toThrow('expired');
  });
  it('rejects missing or malformed authoritative proposal records', () => {
    for (const value of [null, { ...proposal(), expiresAt: 'unknown' }, { ...proposal(), workout: { blocks: [] } }, { ...proposal(), proposalId: 'wrong' }]) {
      expect(() => checkedPersonalProposal(value, 'proposal_2', 'athlete_1')).toThrow();
    }
  });
  it('keeps only user and assistant message content, sorted by stable server sequence', () => {
    expect(orderedPersonalMessages([{ role: 'system', content: 'internal', sequence: 1 }, { role: 'assistant', content: 'Reply', sequence: 3 }, { role: 'user', content: 'Ask', sequence: 2 }])
      .map(row => row.content)).toEqual(['Ask', 'Reply']);
  });
});

describe('refine and publish the reviewed proposal', () => {
  it('sends the exact server base ID while preserving time, equipment, date, and original target', () => {
    const current = { ...proposal(), workoutId: 'personal_existing', expectedRevision: 3, sourceWorkout: { planId: 'assigned', workoutId: 'slot', revision: 1 } };
    expect(personalRefinementParams(current, '  Add a passing drill  ')).toEqual({
      workoutId: 'personal_existing', expectedRevision: 3, expectedScheduleRevision: 4, scheduledDate: current.scheduledDate, timezone: current.timezone,
      intake: current.intake, sourceWorkout: current.sourceWorkout, conversationId: 'conversation_1', baseProposalId: 'proposal_2',
      requestText: 'Add a passing drill', timeAvailableMinutes: 15,
    });
    expect(current.workout.blocks).toHaveLength(1);
  });
  it('allows fresh training conditions without allowing overrides to change proposal identity or workout payload', () => {
    const params = personalRefinementParams(proposal(), 'Make it shorter', { timeAvailableMinutes: 10, expectedScheduleRevision: 6,
      conversationId: 'another', baseProposalId: 'another', workoutId: 'another', workout: { blocks: [] } });
    expect(params).toMatchObject({ timeAvailableMinutes: 10, expectedScheduleRevision: 6, conversationId: 'conversation_1', baseProposalId: 'proposal_2' });
    expect(params).not.toHaveProperty('workout'); expect(params).not.toHaveProperty('workoutId');
  });
  it('retains the frozen source of a new copy through refinement without changing its saved identity', () => {
    const current = { ...proposal(), copyFromWorkoutId: 'personal_finished' };
    const params = personalRefinementParams(current, 'Add passing');
    expect(params.copyFromWorkoutId).toBe('personal_finished'); expect(params).not.toHaveProperty('workoutId');
    expect(personalPublishParams(current, conversation(), expiry.getTime() - 1000)).not.toHaveProperty('copyFromWorkoutId');
  });
  it('publishes the exact server workout and schedule without putting chat text into the saved workout', () => {
    const current = { ...proposal(), requestText: 'Private athlete request', assistantMessage: 'Private assistant response' };
    const params = personalPublishParams(current, conversation(), expiry.getTime() - 1000);
    expect(params.workout).toBe(current.workout);
    expect(params).toMatchObject({ proposalId: 'proposal_2', expectedRevision: 0, expectedScheduleRevision: 4 });
    expect(params).not.toHaveProperty('requestText'); expect(params).not.toHaveProperty('assistantMessage');
  });
  it('rejects stale publish when another device advanced the conversation', () => {
    expect(() => personalPublishParams(proposal(), { ...conversation(), latestProposalId: 'proposal_3', proposalRevision: 3 }, expiry.getTime() - 1000)).toThrow('newer workout proposal');
  });
  it('retains compatibility for old unsaved proposals without inventing a conversation', () => {
    const old = { ...proposal(), conversationId: undefined };
    expect(personalPublishParams(old, null, expiry.getTime() - 1000).proposalId).toBe('proposal_2');
    expect(() => personalRefinementParams(old, 'Another drill')).toThrow('older proposal');
  });
  it('marks only the exact current published proposal as saved', () => {
    const current = { ...conversation(), publishedWorkoutId: 'personal_saved', publishedProposalId: 'proposal_2' };
    expect(publishedPersonalWorkoutId(proposal(), current)).toBe('personal_saved');
    expect(personalProposalWithPublication(proposal(), current)?.publishedWorkoutId).toBe('personal_saved');
  });
  it('does not short-circuit publication of a revised head because an earlier draft was published', () => {
    const current = { ...conversation(), publishedWorkoutId: 'personal_saved', publishedProposalId: 'proposal_1' };
    expect(publishedPersonalWorkoutId(proposal(), current)).toBeNull();
    expect(personalProposalWithPublication({ ...proposal(), publishedWorkoutId: 'stale' }, current)).not.toHaveProperty('publishedWorkoutId');
  });
});
