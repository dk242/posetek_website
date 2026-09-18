import { useEffect, useState } from 'react';
import { db } from '../../../lib/firebase';
import type { Row } from './execution';
import { boundFeedback } from './technique-evidence';

export function usePublishedFeedback(playerId: string, type: 'single' | 'comparison', id: string, expectedJobId: string | undefined, preview: boolean) {
  const [state, setState] = useState<{ feedback: Row | null; error: string; key: string }>({ feedback: null, error: '', key: '' });
  const key = `${playerId}:${type}:${id}:${expectedJobId || ''}`;
  useEffect(() => {
    if (!id || preview) return;
    let active = true, sourceReady = false, correctionReady = false, sourceFailed = false, correctionFailed = false, source: Row | null = null, correction: Row | null = null;
    const player = db.collection('players').doc(playerId);
    const emit = () => {
      if (!active) return;
      const consistent = sourceReady && correctionReady && (!expectedJobId || source?.jobId === expectedJobId);
      setState({ key, error: sourceFailed || correctionFailed ? 'Published coach feedback could not refresh. Showing the original report.' : '', feedback: consistent ? boundFeedback(correction, source, { playerId, type, id }) : null });
    };
    const sourceStop = player.collection(type === 'single' ? 'aiAnalyses' : 'aiKickComparisons').doc(id).onSnapshot({ includeMetadataChanges: true }, snapshot => {
      sourceReady = !snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites;
      sourceFailed = false;
      source = snapshot.exists ? { ...snapshot.data(), id: snapshot.id } : null; emit();
    }, () => { sourceReady = false; sourceFailed = true; emit(); });
    const correctionStop = player.collection('aiAnalysisCorrections').doc(`${type}_${id}`).onSnapshot({ includeMetadataChanges: true }, snapshot => {
      correctionReady = !snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites;
      correctionFailed = false;
      correction = snapshot.exists ? snapshot.data()! : null; emit();
    }, () => { correctionReady = false; correctionFailed = true; emit(); });
    return () => { active = false; sourceStop(); correctionStop(); };
  }, [playerId, type, id, expectedJobId, preview, key]);
  return state.key === key && !preview ? state : { feedback: null, error: '' };
}
