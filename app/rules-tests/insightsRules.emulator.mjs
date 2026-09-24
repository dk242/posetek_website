import { firestoreEmulator } from './canonicalRules.mjs';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, collection, getDocs, setLogLevel } from 'firebase/firestore';
setLogLevel('silent');
const env = await initializeTestEnvironment({ projectId: 'demo-expanded-insights', firestore: firestoreEmulator() });
const paths = ['insightSettings/usage', 'insightUsageDays/player', 'insightUsageDays/player/insightUsageDaily/2026-09-17', 'insightUsageDays/player/insightUsageDetailDays/2026-09-17', 'insightUsageIntervals/private', 'insightUsageActors/athlete',
  ...['player', 'legacy'].flatMap(p => ['insightMetadata/reporting', 'insightSummaries/current', 'insightSummaryDays/2026-09-17'].map(s => `players/${p}/${s}`))];
let checks = 0;
try {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'players/player'), { authenticationUID: 'athlete', userUID: 'athlete', organizationId: 'club', teamId: 'team' });
    await setDoc(doc(db, 'players/legacy'), { authenticationUID: 'athlete', coachUID: 'coach' });
    await setDoc(doc(db, 'coaches/coach'), { userUID: 'coach', members: ['player', 'legacy'] });
    for (const [uid, role, teamIds] of [['coach', 'coach', ['team']], ['manager', 'manager', []]]) await setDoc(doc(db, `organizations/club/members/${uid}`), { userUID: uid, role, teamIds, status: 'active' });
    for (const path of paths) await setDoc(doc(db, path), { serverOnly: true });
  });
  const actors = [env.unauthenticatedContext(), ...['athlete', 'coach', 'manager', 'outsider', 'admin'].map(uid => env.authenticatedContext(uid, { email: `${uid}@${uid === 'admin' ? 'posetek.net' : 'example.test'}`, email_verified: true }))];
  for (const actor of actors) for (const path of paths) {
    const db = actor.firestore(); await assertFails(getDoc(doc(db, path))); checks++;
    await assertFails(setDoc(doc(db, path), { forged: true })); checks++;
    await assertFails(getDocs(collection(db, path.split('/').slice(0, -1).join('/')))); checks++;
  }
  console.log(`Expanded Insights rules: ${checks} assertions passed`);
} finally { await env.cleanup(); }
