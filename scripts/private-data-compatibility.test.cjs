const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const identity = require('../firebase-identity.js');

const root = path.resolve(__dirname, '..');
const source = name => fs.readFileSync(path.join(root, name), 'utf8');
const doc = (id, data, exists = true) => ({ id, exists, data: () => data });

function database({ direct, rows = [], deniedField, deniedDirect = false } = {}) {
  const calls = [];
  return {
    calls,
    collection(name) {
      return {
        doc(id) {
          return { async get() {
            calls.push(['get', name, id]);
            if (deniedDirect) throw Object.assign(new Error('denied'), { code: 'permission-denied' });
            return direct || doc(id, undefined, false);
          } };
        },
        where(field, op, uid) {
          return { limit() { return { async get() {
            calls.push(['query', name, field, uid]);
            if (field === deniedField) throw Object.assign(new Error('denied'), { code: 'permission-denied' });
            const docs = rows.filter(row => row.data()[field] === uid);
            return { docs, empty: docs.length === 0 };
          } }; } };
        }
      };
    }
  };
}

test('coach-provisioned athlete resolves by authenticationUID with no email query', async () => {
  const athlete = doc('provisioned-id', { authenticationUID: 'auth-uid', signupEmail: 'other@example.com' });
  const db = database({ rows: [athlete] });
  assert.equal(await identity.findPlayer(db, 'auth-uid'), athlete);
  assert.deepEqual(db.calls, [['query', 'players', 'authenticationUID', 'auth-uid']]);
});

test('legacy userUID resolution precedes an existing UID-path fallback', async () => {
  const athlete = doc('provisioned-id', { userUID: 'auth-uid' });
  const db = database({ rows: [athlete] });
  assert.equal(await identity.findPlayer(db, 'auth-uid'), athlete);
  assert.deepEqual(db.calls.map(call => call[2]), ['authenticationUID', 'userUID']);
  const fallback = doc('auth-uid', {});
  assert.equal(await identity.findPlayer(database({ direct: fallback }), 'auth-uid'), fallback);
  assert.equal(await identity.findPlayer(database(), 'auth-uid'), null);
});

test('a denied player query never becomes a synthetic own player', async () => {
  const db = database({ deniedField: 'authenticationUID', direct: doc('auth-uid', {}) });
  await assert.rejects(identity.findPlayer(db, 'auth-uid'), { code: 'permission-denied' });
  assert.deepEqual(db.calls, [['query', 'players', 'authenticationUID', 'auth-uid']]);
});

test('email-only, conflicting, malformed and nonexistent player bindings are rejected', () => {
  assert.equal(identity.ownsPlayer(doc('other', { signupEmail: 'athlete@example.com' }), 'auth-uid'), false);
  assert.equal(identity.ownsPlayer(doc('auth-uid', { authenticationUID: 'other' }), 'auth-uid'), false);
  assert.equal(identity.ownsPlayer(doc('other', { authenticationUID: 'auth-uid', userUID: 'other' }), 'auth-uid'), false);
  assert.equal(identity.ownsPlayer(doc('auth-uid', { authenticationUID: null }), 'auth-uid'), false);
  assert.equal(identity.ownsPlayer(doc('auth-uid', {}, false), 'auth-uid'), false);
});

test('denied own coach probe still permits a constrained legacy coach UID query', async () => {
  const coach = doc('legacy-coach-id', { userUID: 'coach-uid' });
  const db = database({ deniedDirect: true, rows: [coach] });
  assert.equal(await identity.findCoach(db, 'coach-uid'), coach);
  assert.deepEqual(db.calls, [['get', 'coaches', 'coach-uid'], ['query', 'coaches', 'userUID', 'coach-uid']]);
});

function namedFunction(file, name) {
  const match = source(file).match(new RegExp('(?:async )?function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n        \\}'));
  assert.ok(match, `${file}: ${name}`);
  return match[0];
}

function signupSandbox(elements, { fail = false } = {}) {
  const calls = [];
  const state = { deleted: false, redirect: null, calls };
  const user = { uid: 'new-user', sendEmailVerification: async () => {}, delete: async () => { state.deleted = true; } };
  const sandbox = {
    document: { getElementById: id => elements[id] },
    auth: { createUserWithEmailAndPassword: async () => ({ user }) },
    admissionFunctions: { httpsCallable: name => async data => { calls.push([name, JSON.parse(JSON.stringify(data))]); if (fail) throw new Error('That code is not valid or has expired.'); return { data: { playerId: 'p1', organizationId: 'org' } }; } },
    discardFailedSignup: async u => { if (u) await u.delete(); },
    showLoading() {}, hideLoading() {}, setTimeout: fn => fn(),
    window: { location: {} }, console: { error() {} }, encodeURIComponent, Error
  };
  Object.defineProperty(sandbox.window.location, 'href', { set(value) { state.redirect = value; } });
  return { sandbox, state };
}

test('player-code signup redeems through the admission service and discards the account on failure', async () => {
  const elements = () => ({ playerCode: { value: ' fresh1 ' }, playerEmail: { value: 'a@example.test' }, playerPassword: { value: 'pw' }, playerConfirmPassword: { value: 'pw' }, playerCodeError: { style: {} }, playerCodeSuccess: { style: {} }, playerCodeSubmit: {}, playerCodeSpinner: {} });
  const ok = signupSandbox(elements());
  await vm.runInNewContext('(' + namedFunction('kickai.html', 'handlePlayerCodeSignup') + ')', ok.sandbox)();
  assert.deepEqual(ok.state.calls, [['redeemPlayerSignupCode', { code: 'fresh1' }]]);
  assert.equal(ok.state.redirect, 'profile.html?userType=player&player=p1');
  assert.equal(ok.state.deleted, false);
  const failed = signupSandbox(elements(), { fail: true });
  const errorElement = elements();
  failed.sandbox.document = { getElementById: id => errorElement[id] };
  await vm.runInNewContext('(' + namedFunction('kickai.html', 'handlePlayerCodeSignup') + ')', failed.sandbox)();
  assert.equal(failed.state.deleted, true, 'a failed redemption never leaves an orphan Auth user');
  assert.match(errorElement.playerCodeError.textContent, /not valid/);
  assert.equal(failed.state.redirect, null);
  assert.ok(!namedFunction('kickai.html', 'handlePlayerCodeSignup').includes('db.'), 'no client Firestore access');
});

test('organization signup joins or creates through the admission service only', async () => {
  const elements = { firstName: { value: 'Ada' }, lastName: { value: 'Smith' }, signupEmail: { value: 'a@example.test' }, signupPassword: { value: 'pw' }, confirmPassword: { value: 'pw' }, userType: { value: 'player' }, orgCode: { value: 'orgfresh' }, orgSignupError: { style: {} }, orgSignupSuccess: { style: {} }, orgSignupSubmit: {}, orgSignupSpinner: {} };
  const { sandbox, state } = signupSandbox(elements);
  const handler = vm.runInNewContext('(' + namedFunction('kickai.html', 'handleOrgSignup') + ')', sandbox);
  await handler();
  assert.deepEqual(state.calls, [['joinOrganization', { code: 'orgfresh', role: 'player', firstName: 'Ada', lastName: 'Smith' }]]);
  assert.equal(state.redirect, 'profile.html?userType=player');
  elements.userType.value = 'coach';
  sandbox.showCoachOrgModal = async () => ({ action: 'create', value: 'New Club' });
  await handler();
  assert.deepEqual(state.calls.at(-1), ['createOrganization', { name: 'New Club', firstName: 'Ada', lastName: 'Smith' }]);
  assert.equal(state.redirect, 'coachesview.html?userType=coach');
  assert.ok(!namedFunction('kickai.html', 'handleOrgSignup').includes('db.'), 'no client Firestore access');
});

test('coach roster attachment by code uses the admission service, never a player query', async () => {
  const match = source('coach-roster.js').match(/async function addExisting\(\)\{[\s\S]*?\n  \}/);
  assert.ok(match);
  const calls = [];
  const elements = { existingPlayerCode: { value: ' plrfresh ' }, addExistingButton: {} };
  let reloaded = false;
  const sandbox = {
    auth: { currentUser: { uid: 'coach-auth' } },
    coachDoc: doc('legacy-coach-doc', { userUID: 'coach-auth' }),
    document: { getElementById: id => elements[id] },
    firebase: { functions: () => ({ httpsCallable: name => async data => { calls.push([name, JSON.parse(JSON.stringify(data))]); return { data: { playerId: 'p' } }; } }) },
    setMessage() {}, dialog: { close() {} }, loadRoster: async () => { reloaded = true; }
  };
  await vm.runInNewContext('(' + match[0] + ')', sandbox)();
  assert.deepEqual(calls, [['attachPlayerByCode', { code: 'PLRFRESH' }]]);
  assert.equal(reloaded, true);
  assert.ok(!match[0].includes('db.'));
});

test('paused paid-analysis forms return before creating accounts or entitlements', async () => {
  for (const file of ['hypothesis_athleticismSubscription_signup.html', 'hypothesis_kickingAnalysisSubscription_signup.html', 'kickingAnalysis_upload.html']) {
    const match = source(file).match(/accountForm\.addEventListener\('submit', (async[\s\S]*?\n        \})\);/);
    assert.ok(match, file);
    let message;
    const handler = vm.runInNewContext('(' + match[1] + ')', { setAccountStatus: value => { message = value; } });
    await handler({ preventDefault() {} });
    assert.match(message, /temporarily unavailable/);
    assert.match(source(file), /<fieldset disabled/);
  }
});

test('forged checkout-return parameters cause no payment writes', async () => {
  for (const file of ['subscriptionWaitlist.html', 'fusionclinic.html']) {
    const status = { textContent: '' };
    const handler = vm.runInNewContext('(' + namedFunction(file, 'markCompletedPaymentReturn') + ')', {
      URLSearchParams,
      window: { location: { search: '?completed_payment=true&client_reference_id=someone-else' } },
      isTruthyParam: value => value === 'true',
      document: { getElementById: () => status },
      setStatus: value => { status.textContent = value; },
      showPaymentCompleteHero() {},
      clearStoredWaitlistDocId() {},
      clearStoredSignupId() {}
    });
    await handler();
    assert.match(status.textContent, /If your payment completed/);
  }
});

test('public waitlist display reads the server aggregate, never submission records', async () => {
  let displayed;
  const handler = vm.runInNewContext('(' + namedFunction('subscriptionWaitlist.html', 'loadSpotCount') + ')', {
    firebase: { functions: () => ({ httpsCallable: name => async data => { assert.equal(name, 'getPublicSpotCount'); assert.deepEqual(JSON.parse(JSON.stringify(data)), { collection: 'subscriptionWaitlist' }); return { data: { remaining: 21 } }; } }) },
    updateSpotDisplay: value => { displayed = value; }, TOTAL_SPOTS: 50, console
  });
  await handler();
  assert.equal(displayed, 21);
  assert.ok(!namedFunction('subscriptionWaitlist.html', 'loadSpotCount').includes('db.'));
});

test('clinic reservation writes only the fields the rules admit and starts unpaid', async () => {
  const sets = [];
  const handler = vm.runInNewContext('(' + namedFunction('fusionclinic.html', 'reserveSlotAndCreateSignup') + ')', {
    slotById: { 'slot-1': { startISO: 's', endISO: 'e', rangeLabel: '4:00-4:05 PM' } },
    EVENT_ID: '2026-05-12', EVENT_DATE_LABEL: 'Tuesday, May 12, 2026',
    SLOTS_COLLECTION: 'fusionClinicSlots', SIGNUPS_COLLECTION: 'fusionClinicSignups',
    firebase: { firestore: { FieldValue: { serverTimestamp: () => 'server-time' } } },
    db: {
      collection(name) { return { doc: id => ({ path: name + '/' + (id || 'generated'), id: id || 'generated' }) }; },
      async runTransaction(callback) {
        await callback({ async get() { return { exists: false }; }, set(ref, payload) { sets.push([ref.path, payload]); } });
      }
    }, Error
  });
  const signupId = await handler({ slotId: 'slot-1', playerFirst: 'A', playerLast: 'B', parentFirst: 'C', parentLast: 'D', parentEmail: 'p@example.test' });
  assert.equal(signupId, 'generated');
  const [[slotPath, slot], [signupPath, signup]] = sets;
  assert.equal(slotPath, 'fusionClinicSlots/slot-1');
  assert.equal(signupPath, 'fusionClinicSignups/generated');
  assert.deepEqual(Object.keys(slot).sort(), ['eventId', 'reservedAt', 'signupId', 'slotEndISO', 'slotId', 'slotLabel', 'slotStartISO', 'status', 'taken'].sort());
  assert.deepEqual(Object.keys(signup).sort(), ['clinicStatus', 'email', 'eventDate', 'eventId', 'parentEmail', 'parentFirstName', 'parentLastName', 'paymentCompleted', 'playerFirstName', 'playerLastName', 'slotEndISO', 'slotId', 'slotLabel', 'slotStartISO', 'source', 'submittedAt'].sort());
  assert.equal(slot.status, 'pending');
  assert.equal(signup.paymentCompleted, false);
  assert.equal(signup.clinicStatus, 'pending_checkout');
});

test('athlete team standings come from the admission projection without touching Firestore', async () => {
  const page = source('athlete-mobile-pages.js');
  const loader = page.match(/async function loadAthleteStandings\(context\) \{[\s\S]*?\n  \}/);
  const shared = page.match(/function standingsFromPlayers\(players\) \{[\s\S]*?\n  \}/);
  assert.ok(loader && shared);
  const sandbox = {
    firebase: { functions: () => ({ httpsCallable: () => async () => ({ data: { playerId: 'me', athletes: [{ id: 'me', firstName: 'A', lastName: 'B', reps: [{ repType: 'sprint', max_velocity: 8 }] }, { id: 'tm', firstName: 'C', lastName: 'D', reps: [{ repType: 'sprint', max_velocity: 9 }] }] } }) }) },
    LEADERBOARD_CATEGORIES: [{ key: 'sprint', lower: false, fields: ['max_velocity', 'maxVelocity'], convert: value => value * 2.23694 }],
    number: value => (typeof value === 'number' ? value : null)
  };
  vm.runInNewContext(shared[0], sandbox);
  const boards = await vm.runInNewContext('(' + loader[0] + ')', sandbox)({ fullName: p => p.firstName + ' ' + p.lastName });
  assert.deepEqual(boards.sprint.map(row => row.id), ['me', 'tm']);
  assert.ok(!loader[0].includes('context.db'));
});

test('legacy leaderboard uses the authenticated coach rather than URL role or coach ID', async () => {
  const page = source('leaderboard.html');
  const start = page.indexOf('        auth.onAuthStateChanged(async (user) => {');
  const end = page.indexOf('        // ── Side nav ──', start);
  assert.ok(start >= 0 && end > start);
  for (const coach of [null, doc('trusted-coach-id', { userUID: 'coach-auth' })]) {
    let callback;
    let loadedCoach;
    let athleteBoard = false;
    const emptyState = { style: {} };
    vm.runInNewContext(page.slice(start, end), {
      auth: { onAuthStateChanged: handler => { callback = handler; } },
      PoseTekIdentity: { findCoach: async () => coach },
      db: {},
      window: { location: { search: '?userType=coach&coach=foreign-coach' } },
      initLeaderboard: async id => { loadedCoach = id; },
      initAthleteLeaderboard: async () => { athleteBoard = true; },
      loadingState: { style: {} },
      emptyState,
      console
    });
    await callback({ uid: 'coach-auth' });
    if (coach) assert.equal(loadedCoach, 'trusted-coach-id');
    else {
      assert.equal(loadedCoach, undefined);
      assert.equal(athleteBoard, true, 'a non-coach gets the projected athlete board, never a URL-chosen coach');
    }
  }
});

test('coach creates a narrowly owned player before linking a legacy coach roster and retries without duplicates', async () => {
  const match = source('coach-roster.js').match(/async function createPlayer\(\)\{[\s\S]*?\n  \}/);
  assert.ok(match);
  const elements = {
    newFirstName: { value: ' Ada ' },
    newLastName: { value: ' Smith ' },
    createPlayerButton: {}
  };
  const coach = { userUID: 'coach-auth', members: ['existing-player'] };
  const coachRef = { id: 'legacy-coach-doc' };
  const writes = [];
  const messages = [];
  let attempts = 0;
  let createdPayload;
  let rosterPayload;
  const sandbox = {
    auth: { currentUser: { uid: 'coach-auth' } },
    coachDoc: { ...doc('legacy-coach-doc', coach), ref: coachRef },
    pendingRosterPlayer: null,
    document: { getElementById: id => elements[id] },
    firebase: { firestore: { FieldValue: { serverTimestamp: () => 'server-time' } } },
    makeCode: () => 'PLRTEST',
    setMessage: value => messages.push(value),
    dialog: { close() {} },
    loadRoster: async () => {},
    db: {
      collection(name) {
        assert.equal(name, 'players');
        return { doc() { return { id: 'new-player', async set(payload) {
          writes.push('player');
          createdPayload = JSON.parse(JSON.stringify(payload));
        } }; } };
      },
      async runTransaction(callback) {
        writes.push('roster');
        attempts++;
        await callback({
          async get(ref) {
            assert.equal(ref, coachRef);
            return doc('legacy-coach-doc', coach);
          },
          update(ref, payload) {
            assert.equal(ref, coachRef);
            rosterPayload = JSON.parse(JSON.stringify(payload));
          }
        });
        // Simulate a committed roster change whose acknowledgement was lost.
        if (attempts === 1) {
          Object.assign(coach, rosterPayload);
          throw new Error('lost acknowledgement');
        }
      }
    }
  };
  const handler = vm.runInNewContext('(' + match[0] + ')', sandbox);
  await handler();
  assert.deepEqual(createdPayload, {
    firstName: 'Ada', lastName: 'Smith', coachUID: 'coach-auth', coachDocId: 'legacy-coach-doc',
    registered: false, signupCode: 'PLRTEST', signupCodeVersion: 2, createdAt: 'server-time', updatedAt: 'server-time'
  });
  assert.deepEqual(writes, ['player', 'roster']);
  assert.deepEqual(rosterPayload, { members: ['existing-player', 'new-player'], numberMembers: 2 });
  assert.equal(sandbox.pendingRosterPlayer.id, 'new-player');
  assert.equal(elements.createPlayerButton.textContent, 'Retry Roster Link');
  assert.equal(elements.newFirstName.disabled, true);
  assert.match(messages.at(-1), /Player created, but the roster link could not be saved/);
  rosterPayload = undefined;
  await handler();
  assert.deepEqual(writes, ['player', 'roster', 'roster']);
  assert.equal(rosterPayload, undefined, 'an already committed member is not appended twice');
  assert.equal(sandbox.pendingRosterPlayer, null);
  assert.equal(elements.createPlayerButton.textContent, 'Create Player');
  assert.equal(elements.newFirstName.disabled, false);
});
