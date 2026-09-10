const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function component(fetch) {
  const source = fs.readFileSync(path.join(__dirname, '../src/components/SearchComponent.vue'), 'utf8');
  const script = source.match(/<script>([\s\S]*?)<\/script>/)[1];
  const options = vm.runInNewContext(script.replace('export default', 'module.exports ='), {
    module: { exports: {} }, fetch, alert: message => { throw new Error(message); }, encodeURIComponent, FormData,
  });
  const instance = options.data();
  for (const [name, method] of Object.entries(options.methods)) instance[name] = method.bind(instance);
  return instance;
}
const ok = data => ({ ok: true, json: async () => data });

test('empty searches keep all options and selection changes preserve the active search', async () => {
  const requests = [];
  const app = component(async (url, options) => {
    requests.push({ url, body: options && JSON.parse(options.body) });
    return ok(url === '/collections' ? ['alice', 'bob'] : []);
  });
  await app.refreshCollections();
  app.searchQuery = 'Missing card';
  await app.searchItems();
  assert.deepEqual(app.collections, ['alice', 'bob']);
  app.selectedFilename = 'bob';
  await app.loadResults();
  assert.deepEqual(requests.at(-1).body, { query: 'Missing card', filename: 'bob' });
  app.searchQuery = '';
  await app.searchItems();
  assert.equal(requests.at(-1).url, '/files?filename=bob');
  app.multiSearchTerms = '1 Sol Ring';
  await app.performMultiSearch();
  app.selectedFilename = 'alice';
  await app.loadResults();
  assert.deepEqual(requests.at(-1).body, { terms: ['Sol Ring'], filename: 'alice' });
  assert.deepEqual(app.collections, ['alice', 'bob']);
});

test('collection refresh adds uploads and clears a deleted selection', async () => {
  let collections = ['alice'];
  const requests = [];
  const app = component(async url => {
    requests.push(url);
    return ok(url === '/collections' ? collections : []);
  });
  await app.refreshCollections();
  app.selectedFilename = 'alice';
  collections = ['alice', 'bob'];
  await app.refreshCollections();
  assert.equal(app.selectedFilename, 'alice');
  assert.deepEqual(app.collections, ['alice', 'bob']);
  collections = ['bob'];
  await app.refreshCollections();
  assert.equal(app.selectedFilename, '');
  assert.equal(requests.at(-1), '/files');
});

test('late results from a previous collection cannot overwrite the latest selection', async () => {
  let finishOld;
  const app = component(url => url.includes('alice')
    ? new Promise(resolve => { finishOld = resolve; })
    : Promise.resolve(ok([{ Name: 'Bob card', filename: 'bob' }])));
  app.selectedFilename = 'alice';
  const old = app.loadResults();
  app.selectedFilename = 'bob';
  await app.loadResults();
  finishOld(ok([{ Name: 'Alice card', filename: 'alice' }]));
  await old;
  assert.equal(app.names[0].Name, 'Bob card');
  assert.equal(app.loading, false);
});

const failed = (status, message) => ({ ok: false, status, json: async () => ({ message }) });

test('search failures show errors without treating error objects as results, and retry succeeds', async () => {
  let response = failed(500, 'Search unavailable');
  const app = component(async () => response);
  app.collections = ['alice', 'bob'];
  app.searchQuery = 'Card';
  await app.searchItems();
  assert.match(app.resultsError, /Search unavailable/);
  assert.equal(app.names.length, 0);
  assert.equal(app.loading, false);
  assert.deepEqual(app.collections, ['alice', 'bob']);
  response = ok({ message: 'Unexpected object' });
  await app.loadResults();
  assert.match(app.resultsError, /invalid card results/);
  response = ok([null]);
  await app.loadResults();
  assert.match(app.resultsError, /invalid card results/);
  response = ok([{ Name: 'Card', filename: 'alice' }]);
  await app.loadResults();
  assert.equal(app.resultsError, '');
  assert.equal(app.names.length, 1);
});

test('network, non-JSON and null error responses have readable messages', async () => {
  for (const [fetch, pattern] of [
    [async () => { throw new Error('Failed to fetch'); }, /Check your connection/],
    [async () => ({ ok: false, status: 502, json: async () => { throw new Error('HTML'); } }), /HTTP 502/],
    [async () => ({ ok: false, status: 403, json: async () => null }), /HTTP 403/],
    [async () => ({ ok: true, json: async () => { throw new Error('Invalid JSON'); } }), /invalid response/],
  ]) {
    const app = component(fetch);
    await app.loadResults();
    assert.match(app.resultsError, pattern);
    assert.equal(app.loading, false);
  }
});

test('rejected uploads and deletions retain inputs and dialogs without refreshing or reporting success', async () => {
  for (const operation of ['uploadFile', 'deleteCSV']) {
    const requests = [];
    const app = component(async url => { requests.push(url); return failed(403, 'Incorrect password'); });
    app.file = new Blob(['Name,Scryfall ID\nCard,id\n']);
    app.username = 'alice';
    app.password = 'wrong';
    app.selectedFilename = 'alice';
    app.collections = ['alice'];
    app.showModal = true;
    app.showDeleteModal = true;
    await app[operation]();
    assert.equal(requests.length, 1);
    assert.match(operation === 'uploadFile' ? app.uploadError : app.deleteError, /Incorrect password/);
    assert.equal(app.showModal, true);
    assert.equal(app.showDeleteModal, true);
    assert.equal(app.password, 'wrong');
    assert.equal(app.selectedFilename, 'alice');
    assert.equal(app.notice, '');
    assert.equal(app.uploading, false);
    assert.equal(app.deleting, false);
  }
});

test('pending mutations cannot be submitted twice and refresh errors do not undo reported success', async () => {
  for (const operation of ['uploadFile', 'deleteCSV']) {
    let finish;
    let submissions = 0;
    const app = component(async url => {
      if (url === '/collections') return failed(500, 'Refresh unavailable');
      submissions++;
      return new Promise(resolve => { finish = resolve; });
    });
    app.file = new Blob(['Name,Scryfall ID\nCard,id\n']);
    app.username = 'alice';
    app.password = 'correct';
    app.selectedFilename = 'alice';
    app.collections = ['alice'];
    app.showModal = true;
    app.showDeleteModal = true;
    const first = app[operation]();
    await app[operation]();
    assert.equal(submissions, 1);
    finish(ok({ message: 'Success' }));
    await first;
    assert.match(app.notice, /successfully/);
    assert.match(app.collectionsError, /Refresh unavailable/);
    assert.equal(operation === 'uploadFile' ? app.showModal : app.showDeleteModal, false);
    assert.equal(app.uploadError, '');
    assert.equal(app.deleteError, '');
    assert.equal(app.uploading, false);
    assert.equal(app.deleting, false);
  }
});

test('failed multisearch preserves the decklist and dialog for retry', async () => {
  let response = failed(400, 'Too many terms');
  const app = component(async () => response);
  app.showMultiSearchModal = true;
  app.multiSearchTerms = '1 Sol Ring';
  await app.performMultiSearch();
  assert.equal(app.showMultiSearchModal, true);
  assert.equal(app.multiSearchTerms, '1 Sol Ring');
  assert.match(app.resultsError, /Too many terms/);
  response = ok([]);
  await app.performMultiSearch();
  assert.equal(app.showMultiSearchModal, false);
  assert.equal(app.resultsError, '');
});

test('invalid collection metadata preserves existing options', async () => {
  const app = component(async () => ok({ message: 'Unexpected object' }));
  app.collections = ['alice'];
  app.selectedFilename = 'alice';
  await app.refreshCollections();
  assert.deepEqual(app.collections, ['alice']);
  assert.equal(app.selectedFilename, 'alice');
  assert.match(app.collectionsError, /invalid collection list/);
});

test('surge foil aliases display a distinct finish label', () => {
  const app = component(async () => ok([]));
  for (const finish of ['surgefoil', 'surge foil', 'SURGE-FOIL', ' surge_foil ']) {
    assert.equal(app.finishLabel(finish), ' surge foil');
  }
  assert.equal(app.finishLabel(' FOIL '), ' foil');
  assert.equal(app.finishLabel('non-foil'), '');
  assert.equal(app.finishLabel(undefined), '');
});
