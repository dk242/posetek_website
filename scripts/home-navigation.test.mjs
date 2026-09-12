import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const script = readFileSync(new URL('../deployment/home-navigation.js', import.meta.url), 'utf8');
function browser() {
  const handlers = {}, calls = [];
  class Element {
    constructor(href, target = '') { this.href = href; this.target = target; }
    closest() { return this; }
    hasAttribute(name) { return name === 'download' && !!this.download; }
  }
  const location = { origin: 'https://posetek.net', href: 'https://posetek.net/signin', pathname: '/signin',
    assign: url => calls.push(['assign', url]), reload: () => calls.push(['reload']) };
  const on = (event, handler) => { handlers[event] = handler; };
  runInNewContext(script, { URL, Element, location,
    window: { addEventListener: on }, document: { addEventListener: on, getElementById: () => ({}) },
    MutationObserver: class { constructor(callback) { handlers.mutation = callback; } observe() {} } });
  function click(href, options = {}) {
    const event = { button: 0, target: new Element(href), preventDefault() { this.prevented = true; }, stopPropagation() {}, ...options };
    handlers.click(event); return event;
  }
  return { calls, handlers, location, click };
}
test('home links leave the SPA and retain their hash', () => {
  const b = browser();
  assert.equal(b.click('https://posetek.net/#tests').prevented, true);
  assert.deepEqual(b.calls, [['assign', 'https://posetek.net/#tests']]);
});
test('application and external links retain their normal behavior', () => {
  const b = browser();
  for (const href of ['https://posetek.net/admin', 'https://posetek.net/privacy', 'https://example.com/']) assert.equal(b.click(href).prevented, undefined);
  assert.deepEqual(b.calls, []);
});
test('modifier clicks and already handled clicks are respected', () => {
  const b = browser();
  for (const options of [{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true},{button:1},{defaultPrevented:true}]) b.click('https://posetek.net/', options);
  assert.deepEqual(b.calls, []);
});
test('browser history and programmatic home navigation load the homepage once', () => {
  const b = browser(); b.location.pathname = '/';
  b.handlers.popstate(); b.handlers.mutation();
  assert.deepEqual(b.calls, [['reload']]);
});
test('restoring an application page from the back-forward cache resets navigation', () => {
  const b = browser(); b.click('https://posetek.net/'); b.handlers.pageshow();
  b.location.pathname = '/index.html'; b.handlers.mutation();
  assert.deepEqual(b.calls, [['assign', 'https://posetek.net/'], ['reload']]);
});
test('an application route does not trigger a reload on DOM changes', () => {
  const b = browser(); b.handlers.mutation(); b.handlers.popstate(); b.handlers.pageshow();
  assert.deepEqual(b.calls, []);
});
