import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

test('context-menu and content-script fallbacks sanitize URLs and reject untrusted senders', async () => {
  const source = await readFile(new URL('../extension/src/background.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  let clicked, message; const opened = []; const asked = [];
  const chrome = {
    storage: { local: { setAccessLevel: async () => {} } },
    runtime: { id: 'extension-id', getURL: value => `chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/${value}`, onInstalled: { addListener() {} }, onMessage: { addListener(fn) { message = fn; } } },
    contextMenus: { create() {}, onClicked: { addListener(fn) { clicked = fn; } } },
    windows: { create: async options => { opened.push(options.url); } }, tabs: { create: async () => {}, sendMessage: async (tabId, msg) => { asked.push([tabId, msg.type, msg.url]); return { screen_name: 'alice', description: 'Tips: paypal.me/alice', links: [] }; } }
  };
  vm.runInNewContext(code, { chrome, URL, console });
  const lastTarget = () => new URL(opened.at(-1)).searchParams.get('url');
  clicked({ pageUrl: 'https://github.com/org/repo', selectionText: '@Alice' }); assert.equal(lastTarget(), 'https://github.com/Alice');
  clicked({ pageUrl: 'https://www.reddit.com/r/example', selectionText: '@example_user' }); assert.equal(lastTarget(), 'https://www.reddit.com/user/example_user/');
  clicked({ linkUrl: 'https://example.com/author?token=secret#fragment' }); assert.equal(lastTarget(), 'https://example.com/author');
  const before = opened.length;
  clicked({ linkUrl: `https://example.com/${'a'.repeat(2050)}` });
  clicked({ linkUrl: 'http://example.com/' });
  clicked({ pageUrl: 'https://github.com/org/repo', selectionText: 'ambiguous name' });
  clicked({ pageUrl: 'https://example.com/article', selectionText: 'x'.repeat(9000) });
  message({ type: 'open-result', url: 'https://github.com/alice' }, { id: 'other-extension', tab: { id: 1 } });
  message({ type: 'open-result', url: 'https://github.com/alice' }, { id: 'extension-id' });
  assert.equal(opened.length, before);
  clicked({ pageUrl: 'https://example.com/article' }); assert.equal(lastTarget(), 'https://example.com/article');
  message({ type: 'open-result', url: 'https://github.com/alice?tracking=x' }, { id: 'extension-id', tab: { id: 1 } });
  assert.equal(lastTarget(), 'https://github.com/alice');
  // Right-clicking a profile link on X, Reddit or Facebook passes the bio that page can see.
  for (const [pageUrl, linkUrl] of [['https://x.com/home', 'https://x.com/alice'], ['https://www.reddit.com/r/x', 'https://www.reddit.com/user/alice/'], ['https://www.facebook.com/feed', 'https://www.facebook.com/alice']]) {
    await clicked({ pageUrl, linkUrl }, { id: 7 });
    assert.deepEqual(asked.at(-1), [7, 'read-profile', linkUrl]);
    const opened2 = new URL(opened.at(-1)).searchParams;
    assert.equal(opened2.get('url'), linkUrl); assert.equal(JSON.parse(opened2.get('xp')).screen_name, 'alice');
  }
  const askedBefore = asked.length; await clicked({ pageUrl: 'https://example.com/', linkUrl: 'https://example.com/me' }, { id: 7 });
  assert.equal(asked.length, askedBefore, 'Other sites are not asked for page data');
  clicked({ pageUrl: 'https://x.com/home', selectionText: '@alice_1' }); assert.equal(lastTarget(), 'https://x.com/alice_1');
  const xBefore = opened.length; clicked({ pageUrl: 'https://x.com/home', selectionText: 'not a handle' }); assert.equal(opened.length, xBefore);
});
