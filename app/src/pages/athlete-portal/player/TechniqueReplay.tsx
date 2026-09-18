import { useEffect, useMemo, useState } from 'react';
import PosePlayback from '../../../components/PosePlayback';
import { auth } from '../../../lib/firebase';
import { sameResultStatus } from '../../../lib/result-values';
import { authArtifacts, fetchJson } from '../lib/loaders';
import { drillByKey } from '../lib/drills';
import { parsePose } from '../lib/metrics';
import type { PosePoint } from '../../../lib/pose-playback';
import type { Row } from './execution';
import { comparisonEvidenceSteps, singleEvidenceSteps } from './technique-evidence';

type Clip = { frames: PosePoint[][]; metadata: Row; mediaUrl: string | null; mediaSource?: string };
function useTechniqueClip(playerId: string, rep: Row | undefined, preview: boolean, retry: number) {
  const [state, setState] = useState<{ clip?: Clip; error?: string }>({});
  useEffect(() => {
    let active = true; setState({});
    if (!rep || preview) return () => { active = false; };
    (async () => {
      const owner = auth.currentUser?.uid;
      if (!owner) throw new Error('Sign in to open the recorded evidence.');
      const payload = await authArtifacts(drillByKey('shooting'), rep, playerId);
      if (rep.resultStatus && payload.resultStatus && !sameResultStatus(rep.resultStatus, payload.resultStatus)) throw new Error('This result changed. Refresh your results before reviewing the analysis.');
      const [rawPose, rawMetadata] = await Promise.all([fetchJson(payload.artifactUrls?.['pose.json']), fetchJson(payload.artifactUrls?.['metadata.json'])]);
      const metadata = rawMetadata || {};
      if (auth.currentUser?.uid !== owner) throw new Error('Your account changed. Reopen the recorded evidence.');
      if (active) setState({ clip: { frames: parsePose(rawPose, metadata), metadata, mediaUrl: payload.mediaUrl || null, mediaSource: payload.source } });
    })().catch(error => { if (active) setState({ error: error.message || 'Recording unavailable. Try again.' }); });
    return () => { active = false; };
    // Exact rep identity/revision controls a reload; unrelated profile updates do not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerId, rep?.id, rep?.resultStatus?.revisionId, rep?.storageFolder, preview, retry]);
  return state;
}

/** Optional detail inside the existing report card. Reports never supply missing clip timing. */
export default function TechniqueReplay({ playerId, rep, otherRep, report, comparison, feedback, preview }: {
  playerId: string; rep: Row; otherRep?: Row; report?: Row | null; comparison?: Row; feedback: Row | null; preview: boolean;
}) {
  const [retry, setRetry] = useState(0), [stepIndex, setStepIndex] = useState(0), [requestKey, setRequestKey] = useState(0);
  const selected = useTechniqueClip(playerId, rep, preview, retry), counterpart = useTechniqueClip(playerId, otherRep, preview, retry);
  const foot = comparison?.leftRepId === rep.id ? 'left' : 'right';
  const clip = selected.clip, otherClip = counterpart.clip;
  const steps = useMemo(() => !clip ? [] : comparison
    ? comparisonEvidenceSteps(comparison, feedback, foot, clip.frames.length, otherClip?.frames.length || 0, clip.frames[0]?.length || 0)
    : singleEvidenceSteps(report || null, feedback, rep.id, clip.frames.length, clip.frames[0]?.length || 0), [clip, otherClip, report, comparison, feedback, foot, rep.id]);
  const step = steps[stepIndex];
  useEffect(() => { setStepIndex(0); setRequestKey(key => key + 1); }, [rep.id, report?.jobId, comparison?.jobId, feedback?.revision]);
  function go(index: number) { setStepIndex(index); setRequestKey(key => key + 1); }
  if (preview) return <p className="muted-copy">Guided review opens the original recording on your signed-in profile.</p>;
  if (selected.error) return <div role="status"><p>{selected.error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>Reload recording</button></div>;
  if (!clip) return <p role="status">Opening the recorded evidence…</p>;
  return <section className="technique-guided-review" aria-label={comparison ? `${foot} foot comparison evidence` : 'Guided technique review'}>
    {comparison && <p className="eyebrow">{foot} foot</p>}
    <PosePlayback frames={clip.frames} metadata={clip.metadata} mediaUrl={clip.mediaUrl} mediaSource={clip.mediaSource} title={comparison ? `${foot === 'left' ? 'Left' : 'Right'} kick` : 'Technique evidence'}
      seekTarget={step ? { frame: step.frame, key: requestKey } : undefined} highlightedJoints={step?.joints || []} nativeControls />
    {step ? <section aria-live="polite"><p className="eyebrow">Finding {stepIndex + 1} of {steps.length} · Frame {step.frame + 1}</p><h3>{step.title}</h3><p><strong>{step.cue}</strong></p><p>{step.detail}</p>{step.evidence && <p className="muted-copy">{step.evidence}</p>}
      <div className="player-actions"><button type="button" disabled={stepIndex === 0} onClick={() => go(stepIndex - 1)}>Previous finding</button><button type="button" onClick={() => go(stepIndex)}>Show marked frame</button><button type="button" disabled={stepIndex >= steps.length - 1} onClick={() => go(stepIndex + 1)}>Next finding</button></div>
      {steps.length > 1 && stepIndex === steps.length - 1 && <button type="button" onClick={() => go(0)}>Review from the first finding</button>}
    </section> : <p className="muted-copy">No supported frame-linked findings are available for this recording. You can still review the saved report and inspect the recording.</p>}
    {comparison && otherRep && <details><summary>Compare the other foot at this finding</summary>
      <p className="muted-copy">Each view uses its own recorded evidence frame. This compares the movement phase, not the speed of the two kicks.</p>
      {counterpart.error ? <div role="status"><p>{counterpart.error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>Reload recordings</button></div> : !otherClip ? <p role="status">Opening the other recording…</p> : step?.counterpartFrame === undefined ? <p>No corresponding frame was recorded for this finding.</p> :
        <PosePlayback frames={otherClip.frames} metadata={otherClip.metadata} mediaUrl={otherClip.mediaUrl} mediaSource={otherClip.mediaSource} title={foot === 'left' ? 'Right kick' : 'Left kick'}
          seekTarget={{ frame: step.counterpartFrame, key: requestKey }} nativeControls />}
    </details>}
  </section>;
}
