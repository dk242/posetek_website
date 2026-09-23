const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function load() {
  const calls = [];
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const mocks = {
    'firebase-functions': { https: { HttpsError }, runWith(options) {
      assert.deepEqual(JSON.parse(JSON.stringify(options)), { timeoutSeconds: 120, memory: '512MB', maxInstances: 10 });
      return { https: { onCall: handler => handler } };
    } },
    'firebase-admin': { initializeApp() {}, firestore() { return {}; }, storage() { return { bucket(name) { assert.equal(name, 'kickai-69dd0.firebasestorage.app'); return {}; } }; } },
    './effective-results': { createEffectiveResults() { return { getResults(data, caller) { calls.push({data, caller}); return 'results'; }, getMedia(data, caller) { calls.push({data, caller}); return 'media'; } }; } },
  };
  const context = { exports: {}, require: name => { assert.ok(Object.hasOwn(mocks, name)); return mocks[name]; } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8'), context);
  return { handlers: context.exports, calls };
}
test('scoped deployment exposes only the two reviewed read callables', () => {
  assert.deepEqual(Object.keys(load().handlers).sort(), ['getAthleteEffectiveResults', 'getAthleteRepMedia']);
});
test('signed-out and anonymous requests never reach the result reader', () => {
  const {handlers, calls} = load();
  for (const handler of Object.values(handlers)) {
    assert.throws(() => handler({}, {}), {code:'unauthenticated'});
    assert.throws(() => handler({}, {auth:{uid:'anonymous',token:{firebase:{sign_in_provider:'anonymous'}}}}), {code:'permission-denied'});
  }
  assert.equal(calls.length, 0);
});
test('actor identity comes from verified transport claims, never the request body', () => {
  const {handlers,calls}=load();
  const data={playerId:'selected-player',uid:'forged',email:'forged@posetek.net'};
  const result=handlers.getAthleteEffectiveResults(data,{auth:{uid:'actual',token:{email:'staff@posetek.net',email_verified:true,firebase:{sign_in_provider:'password'}}}});
  assert.equal(result,'results');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].caller)),{uid:'actual',email:'staff@posetek.net',emailVerified:true,isAnonymous:false});
});
