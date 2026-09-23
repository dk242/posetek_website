import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, runTransaction, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';

const projectId = 'demo-posetek-testing-events';
const env = await initializeTestEnvironment({
  projectId,
  firestore: { rules: fs.readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8197 },
});
const eventId = 'event-a';
const playerId = 'player-a';
const future = new Date(Date.now() + 60 * 60 * 1000);
const auth = uid => env.authenticatedContext(uid, { email: `${uid}@example.test`, email_verified: true }).firestore();
let checks = 0;
const allowed = async value => { await assertSucceeds(value); checks += 1; };
const denied = async value => { await assertFails(value); checks += 1; };

try {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    const fixtures = {
      'organizations/club': { schemaVersion: 2, name: 'Club', memberUIDs: ['manager', 'outsider', 'revoked'] },
      'organizations/club/members/manager': { userUID: 'manager', role: 'manager', status: 'active', teamIds: [] },
      'organizations/club/members/outsider': { userUID: 'outsider', role: 'coach', status: 'active', teamIds: ['team-b'] },
      'organizations/club/members/revoked': { userUID: 'revoked', role: 'coach', status: 'revoked', teamIds: ['team-a'] },
      [`players/${playerId}`]: { organizationId: 'club', teamId: 'team-a', firstName: 'Alex' },
      [`players/${playerId}/sessions/testing-jump`]: { repCount: 0, sessionType: 'jump' },
      [`players/${playerId}/reps/rep-1`]: { repType: 'jump', testingEventId: eventId },
      [`players/${playerId}/recordingCounters/jump`]: { nextSessionNumber: 2, nextAbsoluteRepNumber: 4 },
      [`testingEvents/${eventId}`]: { organizationId: 'club', ownerUid: 'manager', operatorUids: ['manager', 'revoked', 'admin'], status: 'live' },
      [`testingEvents/${eventId}/participants/${playerId}`]: { playerDocId: playerId, rosterOrder: 0 },
      [`testingEvents/${eventId}/stations/station-1`]: {
        id: 'station-1', order: 1, claimedByUid: 'manager', claimedDeviceId: 'phone-a', leaseExpiresAt: future,
      },
      [`testingEvents/${eventId}/stations/station-2`]: {
        id: 'station-2', order: 2, claimedByUid: null, claimedDeviceId: null, leaseExpiresAt: new Date(0),
      },
      'testingEventInvites/hash': { eventId, status: 'pending' },
    };
    await Promise.all(Object.entries(fixtures).map(([path, data]) => setDoc(doc(db, path), data)));
  });

  const manager = auth('manager');
  const outsider = auth('outsider');
  await allowed(getDoc(doc(manager, `testingEvents/${eventId}`)));
  await denied(getDoc(doc(outsider, `testingEvents/${eventId}`)));
  await denied(getDoc(doc(auth('revoked'), `testingEvents/${eventId}`)));
  await denied(updateDoc(doc(manager, `testingEvents/${eventId}`), { status: 'closed' }));
  await denied(getDoc(doc(manager, 'testingEventInvites/hash')));
  await denied(getDoc(doc(manager, `players/${playerId}/recordingCounters/jump`)));

  const progressPath = `testingEvents/${eventId}/progress/station-1_${playerId}`;
  await allowed(setDoc(doc(manager, progressPath), {
    stationId: 'station-1', playerDocId: playerId, status: 'inProgress', currentDrillIndex: 0,
    completedByDrill: {}, completedByProtocolSide: {}, repIds: [], pendingUploadCount: 0,
    revision: 1, updatedAt: serverTimestamp(), deviceId: 'phone-a',
  }));
  await denied(setDoc(doc(manager, `testingEvents/${eventId}/progress/station-2_${playerId}`), {
    stationId: 'station-2', playerDocId: playerId, status: 'inProgress', currentDrillIndex: 0,
    completedByDrill: {}, completedByProtocolSide: {}, repIds: [], pendingUploadCount: 0,
    revision: 1, updatedAt: serverTimestamp(), deviceId: 'phone-a',
  }));

  const sessionRef = doc(manager, `players/${playerId}/sessions/testing-jump`);
  const linkRef = doc(manager, `players/${playerId}/sessions/testing-jump/repLinks/rep-1`);
  const incrementOnce = () => runTransaction(manager, async transaction => {
    if (!(await transaction.get(linkRef)).exists()) {
      transaction.set(linkRef, { repId: 'rep-1', eventId, createdAt: serverTimestamp() });
      transaction.update(sessionRef, { repCount: 1 });
    }
  });
  await allowed(incrementOnce());
  await allowed(incrementOnce());
  assert.equal((await getDoc(sessionRef)).data().repCount, 1);
  await denied(updateDoc(linkRef, { eventId: 'forged' }));

  // A verified PoseTek admin records with a coach's rights: sessions, reps and rep links
  // for an existing athlete, never deletes, never a nonexistent athlete.
  const admin = env.authenticatedContext('admin', { email: 'admin@posetek.net', email_verified: true }).firestore();
  await allowed(getDoc(doc(admin, `testingEvents/${eventId}`)));
  await allowed(setDoc(doc(admin, `players/${playerId}/sessions/admin-jump`), { repCount: 0, sessionType: 'jump' }));
  await allowed(setDoc(doc(admin, `players/${playerId}/reps/rep-2`), { repType: 'jump', testingEventId: eventId }));
  await allowed(setDoc(doc(admin, `players/${playerId}/sessions/admin-jump/repLinks/rep-2`), { repId: 'rep-2', eventId, createdAt: serverTimestamp() }));
  await allowed(updateDoc(doc(admin, `players/${playerId}/sessions/admin-jump`), { repCount: 1 }));
  await denied(deleteDoc(doc(admin, `players/${playerId}/reps/rep-2`)));
  await denied(setDoc(doc(admin, 'players/nobody/sessions/admin-jump'), { repCount: 0, sessionType: 'jump' }));
  assert.equal(checks, 18);
  console.log(`${checks} testing-event rule assertions passed.`);
} finally {
  await env.cleanup();
}
