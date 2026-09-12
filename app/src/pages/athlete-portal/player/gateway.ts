import { useEffect, useState } from 'react';
import { auth, db } from '../../../lib/firebase';
import type { Row } from './execution';

export type Frame = { event: string; data: Row };
export function parseFrame(frame: string): Frame | null {
  let event = 'message'; const lines: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    if (line.startsWith('data:')) lines.push(line.slice(5).trimStart());
  }
  if (!lines.length) return null;
  return { event, data: JSON.parse(lines.join('\n')) };
}

// Both chat surfaces share the transport and require a terminal done event.
// Drafts, memory and handoffs stay tentative until the whole turn completes.
export async function streamCoach(body: Row, signal: AbortSignal, onFrame: (frame: Frame) => void): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in to speak with your coach.');
  const response = await fetch('https://us-central1-kickai-69dd0.cloudfunctions.net/aiCoachStreamProxy', {
    method: 'POST', signal,
    headers: { Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ schemaVersion: 1, clientVersion: '1.1+4', ...body }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || error.message || `Coach unavailable (${response.status}).`);
  }
  if (!response.body) throw new Error('No reply received. Try again.');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', completed = false;
  const apply = (text: string) => {
    const frame = parseFrame(text); if (!frame) return;
    if (frame.event === 'error') throw new Error(frame.data.message || 'The coach could not finish.');
    if (completed) return;
    if (frame.event === 'done') completed = true;
    onFrame(frame);
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const frames = buffer.split(/\r?\n\r?\n/); buffer = frames.pop() || '';
      frames.forEach(apply);
      if (done || completed) break;
    }
    if (!completed && buffer.trim()) apply(buffer);
    if (!completed) throw new Error('The connection ended before the reply was saved. Reopen history or try again.');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function capabilityEnabled(config: Row | null, name: string): boolean {
  if (!config || config.globalEnabled === false || config.unavailable) return false;
  const entry = config?.capabilities?.[name];
  if (['workout_chat', 'apply_workout_draft'].includes(name)) return entry?.enabled === true &&
    Number.isInteger(entry.dailyLimitPerUser) && entry.dailyLimitPerUser > 0;
  return entry?.enabled !== false;
}

export function useCoachConfig(preview: boolean) {
  const [config, setConfig] = useState<Row | null>(preview ? { enabled: true, programV3Enabled: true, coachWorkspaceEnabled: true,
    capabilities: Object.fromEntries(['pose_chat', 'workout_chat', 'coaching_chat', 'apply_workout_draft', 'generate_training_plan'].map(k => [k, { enabled: true, dailyLimitPerUser: 3 }])) } : null);
  useEffect(() => {
    if (preview) return;
    return db.collection('config').doc('llm').onSnapshot(d => setConfig(d.data() || {}), () => setConfig({ unavailable: true }));
  }, [preview]);
  return config;
}

export function validHandoff(value: any, playerId: string): boolean {
  return value?.type === 'workout_request' && value.playerId === playerId &&
    typeof value.request === 'string' && !!value.request.trim() && value.request.length <= 500 &&
    ['workout_builder', 'program_intake'].includes(value.destination);
}

export function jobProgress(job: Row): string {
  const p = job.progress;
  if (p && typeof p.stage === 'string') {
    const fraction = typeof p.fraction === 'number' ? ` · ${Math.round(Math.max(0, Math.min(1, p.fraction)) * 100)}%` : '';
    return `${p.stage.replaceAll('_', ' ')}${fraction}${p.detail ? ` · ${p.detail}` : ''}`;
  }
  return job.status === 'running' ? 'Building your plan…' : 'Waiting for the training engine…';
}
