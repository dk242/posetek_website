import { useEffect, useState } from 'react';
import { auth, db } from '../../../lib/firebase';
import type { Row } from './execution';
import type { PersonalWorkoutStore } from './use-personal-workouts';
import PersonalWorkoutHub, { PersonalPrescription } from './PersonalWorkoutHub';
import { checkedCoachPersonalProposal } from './personal-workout-conversations';

export default function CoachPersonalWorkout({ playerId, athlete, preview, store, config, request, reference, active, onReview }: {
  playerId: string; athlete: Row; preview: boolean; store: PersonalWorkoutStore; config: Row | null;
  request: Row; reference?: Row; active: boolean; onReview: (request: Row) => void;
}) {
  const [link, setLink] = useState<Row | undefined>(reference), [proposal, setProposal] = useState<Row | null>(null), [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [originLoaded, setOriginLoaded] = useState(preview || !!reference);
  useEffect(() => {
    if (preview || !request.originConversationId || !request.originMessageId) return;
    return db.collection('players').doc(playerId).collection('aiConversations').doc(request.originConversationId).collection('messages').doc(request.originMessageId).onSnapshot(d => {
      if (d.data()?.personalWorkoutProposal) setLink(d.data()!.personalWorkoutProposal);
      setOriginLoaded(true);
    }, e => setError(e.message));
  }, [playerId, preview, request.originConversationId, request.originMessageId]);
  useEffect(() => {
    if (!link?.proposalId || preview) return;
    let alive = true;
    void db.collection('players').doc(playerId).collection('personalWorkoutProposals').doc(link.proposalId).get({ source: 'server' }).then(d => {
      const value = d.data();
      if (!alive) return;
      setProposal(checkedCoachPersonalProposal(d.exists ? value! : null, d.id, auth.currentUser?.uid || '', playerId, link.conversationId)); setError('');
    }).catch(e => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [playerId, preview, link?.proposalId, link?.conversationId]);
  useEffect(() => {
    if (active && originLoaded && !link && !ready && !store.saving && !store.conversationLoading) { store.newConversation(); setReady(true); }
  }, [active, originLoaded, link, ready, store.saving, store.conversationLoading]);
  const review = (p: Row) => onReview({ ...request, destination: 'personal_workout', conversationId: p.conversationId, proposalId: p.proposalId });
  if (link) return <section className="personal-coach-preview">{error && <p role="alert">{error}</p>}{proposal ? <><p className="eyebrow">Workout ready to review</p><PersonalPrescription proposal={proposal} /></> : !error && <p role="status">Loading your workout…</p>}<button className="primary-cta" onClick={() => review(link)}>Review in Training</button></section>;
  if (!active) return <button className="hub-secondary" onClick={() => onReview(request)}>Continue workout request in Training</button>;
  if (!ready) return <p role="status">Preparing your workout conversation…</p>;
  return <PersonalWorkoutHub store={store} playerId={playerId} athlete={athlete} preview={preview} config={config} initialCreate initialRequest={request.request} initialHandoff={request} coachOnly onReview={review} onBack={() => {}} />;
}
