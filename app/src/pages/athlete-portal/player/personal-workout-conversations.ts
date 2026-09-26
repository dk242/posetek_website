import type { Row } from './execution';

export type PersonalSelection = { schemaVersion: 1; uid: string; playerId: string; conversationId?: string; proposalId?: string };
export type PersonalConversationPort = {
  conversation: (id: string) => Promise<Row | null>;
  proposal: (id: string) => Promise<Row | null>;
  messages: (id: string) => Promise<Row[]>;
};
const validId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,180}$/.test(v);
export function personalTimestamp(value: any): number {
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  return value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : NaN;
}

// Local storage can remember where to resume, never what the AI prescribed.
// Older receipts are migrated by extracting their ID and reading it from the server.
export function restorePersonalSelection(value: unknown, uid: string, playerId: string): PersonalSelection | null {
  const v = value as Row | null;
  if (!v || v.uid !== uid || v.playerId !== playerId) return null;
  const conversationId = v.conversationId ?? v.result?.conversationId;
  const proposalId = v.proposalId ?? v.result?.proposalId;
  if (!validId(conversationId) && !validId(proposalId)) return null;
  return { schemaVersion: 1, uid, playerId, ...(validId(conversationId) ? { conversationId } : {}), ...(validId(proposalId) ? { proposalId } : {}) };
}

export function checkedPersonalConversation(value: Row | null, id: string, uid: string): Row {
  if (!value || !validId(id) || value.createdByUid !== uid || value.capability !== 'generate_personal_workout' ||
      !validId(value.latestProposalId) || !Number.isInteger(value.proposalRevision) || value.proposalRevision < 1) {
    throw new Error('This workout conversation is unavailable for this account.');
  }
  return { ...value, id, conversationId: id };
}

export function checkedPersonalProposal(value: Row | null, id: string, uid: string, conversation?: Row): Row {
  if (!value || !validId(id) || value.schemaVersion !== 1 || value.proposalId !== id || value.createdByUid !== uid ||
      value.check?.ok !== true || !value.workout || !Array.isArray(value.workout.blocks) || !value.workout.blocks.length ||
      !Number.isFinite(personalTimestamp(value.expiresAt))) {
    throw new Error('The checked workout proposal could not be loaded. Reopen your workout conversation.');
  }
  if (conversation && (value.conversationId !== conversation.conversationId || id !== conversation.latestProposalId || value.proposalRevision !== conversation.proposalRevision)) {
    throw new Error('The workout changed while loading. Reopen the latest conversation before continuing.');
  }
  return value;
}

export function orderedPersonalMessages(rows: Row[]): Row[] {
  return rows.filter(row => ['user', 'assistant'].includes(row.role) && typeof row.content === 'string')
    .sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0) || personalTimestamp(a.createdAt) - personalTimestamp(b.createdAt));
}

export async function readPersonalConversation(port: PersonalConversationPort, id: string, uid: string) {
  const conversation = checkedPersonalConversation(await port.conversation(id), id, uid);
  const [rawProposal, messages] = await Promise.all([port.proposal(conversation.latestProposalId), port.messages(id)]);
  const proposal = checkedPersonalProposal(rawProposal, conversation.latestProposalId, uid, conversation);
  return { conversation, proposal, messages: orderedPersonalMessages(messages) };
}

export function personalProposalParams(proposal: Row): Row {
  return { ...(proposal.workoutId ? { workoutId: proposal.workoutId } : {}),
    expectedRevision: proposal.expectedRevision, expectedScheduleRevision: proposal.expectedScheduleRevision,
    scheduledDate: proposal.scheduledDate, timezone: proposal.timezone, intake: proposal.intake,
    ...(proposal.sourceWorkout ? { sourceWorkout: proposal.sourceWorkout } : {}) };
}

export function publishedPersonalWorkoutId(proposal: Row | null, conversation: Row | null): string | null {
  return proposal && conversation && conversation.publishedProposalId === proposal.proposalId &&
    conversation.latestProposalId === proposal.proposalId && typeof conversation.publishedWorkoutId === 'string'
    ? conversation.publishedWorkoutId : null;
}

export function personalProposalWithPublication(proposal: Row | null, conversation: Row | null): Row | null {
  if (!proposal) return null;
  const { publishedWorkoutId: _oldMarker, ...raw } = proposal;
  const publishedWorkoutId = publishedPersonalWorkoutId(proposal, conversation);
  return { ...raw, ...(publishedWorkoutId ? { publishedWorkoutId } : {}) };
}

export function personalRefinementParams(proposal: Row, requestText: string, overrides: Row = {}): Row {
  if (!proposal.conversationId) throw new Error('This older proposal cannot continue a conversation. Start a new workout request.');
  const permitted = ['intake', 'timeAvailableMinutes', 'scheduledDate', 'timezone', 'expectedScheduleRevision'];
  return { ...personalProposalParams(proposal), timeAvailableMinutes: proposal.requestedMinutes ?? proposal.workout.budgetMinutes,
    ...(proposal.copyFromWorkoutId ? { copyFromWorkoutId: proposal.copyFromWorkoutId } : {}),
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => permitted.includes(key))),
    conversationId: proposal.conversationId, baseProposalId: proposal.proposalId, requestText: requestText.trim() };
}

export function personalPublishParams(proposal: Row, conversation: Row | null, now = Date.now()): Row {
  if (personalTimestamp(proposal.expiresAt) <= now) throw new Error('This proposal has expired. Ask your AI coach to refresh it before publishing.');
  if (proposal.conversationId && (!conversation || conversation.conversationId !== proposal.conversationId ||
      conversation.latestProposalId !== proposal.proposalId || conversation.proposalRevision !== proposal.proposalRevision)) {
    throw new Error('A newer workout proposal is available. Review it before publishing.');
  }
  return { ...personalProposalParams(proposal), proposalId: proposal.proposalId, workout: proposal.workout };
}
