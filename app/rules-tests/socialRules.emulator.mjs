// Recovered production feed collections are server-only. Exercise real rules
// against isolated emulators; no production credentials or athlete data needed.
import assert from 'node:assert/strict';
import { firestoreEmulator, storageEmulator } from './canonicalRules.mjs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { ref, uploadBytes, getBytes } from 'firebase/storage';

const projectId = 'demo-posetek-feed';
const env = await initializeTestEnvironment({
  projectId,
  firestore: firestoreEmulator(),
  storage: storageEmulator(),
});
const contexts = [
  env.unauthenticatedContext(),
  env.authenticatedContext('athlete', { email: 'athlete@example.test', email_verified: true }),
  env.authenticatedContext('coach', { email: 'coach@example.test', email_verified: true }),
  env.authenticatedContext('admin', { email: 'staff@posetek.net', email_verified: true }),
  env.authenticatedContext('unverified', { email: 'staff@posetek.net', email_verified: false }),
];
const roots = ['socialActivities', 'socialActivitySettings', 'socialPreferences', 'socialConnections',
  'socialSettings', 'socialReports', 'socialRateLimits', 'playerSignupInvitations', 'playerSignupCodes'];
let checks = 0;
const denied = async promise => { await assertFails(promise); checks++; };
const allowed = async promise => { await assertSucceeds(promise); checks++; };
try {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const root of roots) await setDoc(doc(db, root, 'fixture'), { marker: 'synthetic' });
    await setDoc(doc(db, 'socialActivities/fixture/comments/comment'), { text: 'Synthetic comment' });
    await setDoc(doc(db, 'socialActivities/fixture/kudos/athlete'), { uid: 'athlete' });
    await setDoc(doc(db, 'players/player'), { authenticationUID: 'athlete', userUID: 'athlete', organizationId: 'org', teamId: 'team' });
    await uploadBytes(ref(context.storage(), 'player/session1/rep1/video.mp4'), new Uint8Array([1, 2, 3]), { contentType: 'video/mp4' });
  });
  for (const context of contexts) {
    const db = context.firestore();
    for (const root of roots) {
      await denied(getDoc(doc(db, root, 'fixture')));
      await denied(getDocs(collection(db, root)));
      await denied(setDoc(doc(db, root, 'forged'), { marker: 'forged' }));
      await denied(updateDoc(doc(db, root, 'fixture'), { marker: 'changed' }));
      await denied(deleteDoc(doc(db, root, 'fixture')));
    }
    for (const child of ['comments/comment', 'kudos/athlete']) {
      await denied(getDoc(doc(db, 'socialActivities/fixture/' + child)));
      await denied(setDoc(doc(db, 'socialActivities/fixture/' + child), { forged: true }));
    }
  }
  // Migration-sensitive recording policy stays intact while social media is
  // delivered through short-lived URLs issued by getSocialMedia.
  const media = context => ref(context.storage(), 'player/session1/rep1/video.mp4');
  await denied(getBytes(media(contexts[0])));
  await allowed(getBytes(media(contexts[1])));
  await denied(getBytes(media(contexts[2])));
  await allowed(getBytes(media(contexts[3])));
  // Staff test recording (2026-09-16): a verified admin may record into an
  // existing athlete's prefix; an unverified @posetek.net token may not.
  await allowed(uploadBytes(media(contexts[3]), new Uint8Array([4]), { contentType: 'video/mp4' }));
  await denied(uploadBytes(media(contexts[4]), new Uint8Array([4]), { contentType: 'video/mp4' }));
  assert.equal(checks, 251);
  console.log(`${checks} feed and recording access assertions passed against isolated emulators.`);
} finally {
  await env.cleanup();
}
