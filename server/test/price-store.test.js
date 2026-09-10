const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { atomicWrite, createPriceStore, createCollectionLock } = require('../price-store');
const cards = price => JSON.stringify([{ id: 'card', prices: { eur: price, eur_foil: null } }]);
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pod-prices-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'scryfall.json');
  await fs.writeFile(filename, cards('1.00'));
  return { directory, filename };
}

test('shares cached lookups and atomically publishes only complete valid downloads', async t => {
  const { directory, filename } = await fixture(t);
  let payload = cards('2.00');
  let calls = 0;
  let failedStream = false;
  const store = createPriceStore(filename, async url => {
    calls++;
    if (url.endsWith('/bulk-data')) return { data: { data: [{ type: 'default_cards', download_uri: 'https://fixture/cards' }] } };
    return { data: failedStream ? Readable.from((async function* () {
      yield '[';
      throw new Error('download interrupted');
    })()) : Readable.from([payload]) };
  });
  const [first, second] = await Promise.all([store.snapshot(), store.snapshot()]);
  assert.equal(first, second);
  await fs.writeFile(filename, 'corrupted externally');
  assert.equal(await store.snapshot(), first);
  await Promise.all([store.refresh(), store.refresh()]);
  assert.equal(calls, 2);
  assert.equal((await store.snapshot()).get('card').eur, '2.00');
  assert.equal(first.get('card').eur, '1.00');
  const good = await fs.readFile(filename, 'utf8');
  for (const invalid of ['[', '[]', '{}', '[{"id":"card","prices":{}}]']) {
    payload = invalid;
    await assert.rejects(store.refresh());
    assert.equal(await fs.readFile(filename, 'utf8'), good);
    assert.equal((await store.snapshot()).get('card').eur, '2.00');
  }
  failedStream = true;
  await assert.rejects(store.refresh(), /interrupted/);
  assert.equal(await fs.readFile(filename, 'utf8'), good);
  assert.deepEqual(await fs.readdir(directory), ['scryfall.json']);
});

test('missing cache shares a single initial download', async t => {
  const { filename } = await fixture(t);
  await fs.unlink(filename);
  let calls = 0;
  const store = createPriceStore(filename, async url => {
    calls++;
    return url.endsWith('/bulk-data') ? { data: { data: [{ type: 'default_cards', download_uri: 'fixture' }] } } :
      { data: Readable.from([cards('3.00')]) };
  });
  const snapshots = await Promise.all([store.snapshot(), store.snapshot()]);
  assert.equal(snapshots[0], snapshots[1]);
  assert.equal(calls, 2);
});

test('failed writes preserve the destination and clean staged files', async t => {
  const { directory, filename } = await fixture(t);
  const original = await fs.readFile(filename, 'utf8');
  await assert.rejects(atomicWrite(filename, (async function* () {
    yield 'partial';
    throw new Error('write interrupted');
  })()), /interrupted/);
  assert.equal(await fs.readFile(filename, 'utf8'), original);
  assert.deepEqual(await fs.readdir(directory), ['scryfall.json']);
  await atomicWrite(filename, 'complete');
  assert.equal(await fs.readFile(filename, 'utf8'), 'complete');
});

test('collection mutations run in order, including after a failed mutation', async () => {
  const lock = createCollectionLock();
  const events = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const update = lock('alice', async () => { events.push('update'); await gate; throw new Error('failure'); });
  const upload = lock('alice', () => events.push('upload'));
  const deletion = lock('alice', () => events.push('delete'));
  await lock('bob', () => events.push('other collection'));
  assert.deepEqual(events, ['update', 'other collection']);
  release();
  await assert.rejects(update, /failure/);
  await Promise.all([upload, deletion]);
  assert.deepEqual(events, ['update', 'other collection', 'upload', 'delete']);
});
