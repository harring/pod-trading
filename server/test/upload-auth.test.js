const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

// Keep fixtures beside the server so its dependencies resolve normally.
async function startServer(t, secret) {
  const directory = await fs.mkdtemp(path.join(__dirname, '../.auth-test-'));
  await fs.copyFile(path.join(__dirname, '../server.js'), path.join(directory, 'server.js'));
  await fs.copyFile(path.join(__dirname, '../price-store.js'), path.join(directory, 'price-store.js'));
  await fs.mkdir(path.join(directory, 'scryfall'));
  await fs.writeFile(path.join(directory, 'scryfall/scryfall.json'), JSON.stringify([{ id: 'original-id', prices: { eur: '2.50', eur_foil: '5.00' } }]));
  const env = { ...process.env, PORT: '0' };
  delete env.SECRET;
  if (secret !== undefined) env.SECRET = secret;
  const child = spawn(process.execPath, ['-e', `
    const http = require('node:http');
    const listen = http.Server.prototype.listen;
    http.Server.prototype.listen = function (...args) {
      this.once('listening', () => process.send(this.address().port));
      return listen.apply(this, args);
    };
    require('./server.js');
  `], { cwd: directory, env, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  const exited = once(child, 'exit');
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
    await fs.rm(directory, { recursive: true, force: true });
  });
  const port = await Promise.race([
    once(child, 'message').then(([value]) => value),
    exited.then(() => null),
  ]);
  return { directory, port, stderr };
}

test('uploads authenticate before creating or overwriting collections', { timeout: 15000 }, async t => {
  const { directory, port } = await startServer(t, 'test-secret');
  assert.ok(port);
  const collection = path.join(directory, 'textfiles/alice.csv');
  const original = 'Name,Scryfall ID\nOriginal,original-id\n';
  await fs.writeFile(collection, original);

  async function upload(username, password, bodyPassword) {
    const form = new FormData();
    form.append('username', username);
    if (bodyPassword) form.append('password', bodyPassword);
    form.append('file', new Blob(['Name,Scryfall ID\nReplacement,replacement-id\n']), 'cards.csv');
    return fetch(`http://127.0.0.1:${port}/upload`, {
      method: 'POST', headers: password === undefined ? {} : { password }, body: form,
    });
  }

  for (const password of [undefined, 'wrong-password', 'harring']) {
    for (const username of ['alice', 'bob']) {
      const response = await upload(username, password);
      assert.equal(response.status, 403);
      await response.text();
      assert.equal(await fs.readFile(collection, 'utf8'), original);
      assert.deepEqual(await fs.readdir(path.join(directory, 'textfiles')), ['alice.csv']);
    }
  }
  const bodyOnly = await upload('alice', undefined, 'test-secret');
  assert.equal(bodyOnly.status, 403);
  await bodyOnly.text();
  assert.equal(await fs.readFile(collection, 'utf8'), original);

  const accepted = await upload('alice', 'test-secret');
  assert.equal(accepted.status, 200);
  await accepted.text();
  assert.match(await fs.readFile(collection, 'utf8'), /Replacement/);

  // Existing deletion clients may still authenticate using a JSON body.
  const deleted = await fetch(`http://127.0.0.1:${port}/delete/alice.csv`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'test-secret' }),
  });
  assert.equal(deleted.status, 200);
  await deleted.text();
});

test('startup rejects a missing, empty, or whitespace-only SECRET', { timeout: 15000 }, async t => {
  for (const secret of [undefined, '', '   ']) {
    const result = await startServer(t, secret);
    assert.equal(result.port, null);
    assert.match(result.stderr, /SECRET must be set to a non-empty password/);
  }
});

test('validates uploads and confines collection access', { timeout: 15000 }, async t => {
  const { directory, port } = await startServer(t, 'test-secret');
  const original = 'Name,Scryfall ID\nOriginal,original-id\n';
  const collection = path.join(directory, 'textfiles/alice.csv');
  const outside = path.join(directory, 'outside.csv');
  await fs.writeFile(collection, original);
  await fs.writeFile(outside, original);
  await fs.symlink(outside, path.join(directory, 'textfiles/link.csv'));
  const json = (endpoint, body, method = 'POST') => fetch(`http://127.0.0.1:${port}${endpoint}`, {
    method, headers: { 'Content-Type': 'application/json', password: 'test-secret' }, body: JSON.stringify(body),
  });
  async function upload(name, content, filename = 'cards.csv') {
    const form = new FormData();
    // A file preceding the name must also be handled safely.
    form.append('file', new Blob([content]), filename);
    if (name !== undefined) form.append('username', name);
    return fetch(`http://127.0.0.1:${port}/upload`, {
      method: 'POST', headers: { password: 'test-secret' }, body: form,
    });
  }
  async function expectStatus(response, status) {
    assert.equal(response.status, status, await response.text());
    assert.equal(await fs.readFile(collection, 'utf8'), original);
    assert.equal(await fs.readFile(outside, 'utf8'), original);
  }
  for (const name of ['../outside', '/outside', '..\\outside', '.', ' alice', 'a'.repeat(81), 'link', undefined]) {
    await expectStatus(await upload(name, original), 400);
  }
  for (const content of ['', 'Name,Scryfall ID\n', 'Wrong,Headers\nx,y\n',
    'Name,Scryfall ID\nx\n', 'Name,Scryfall ID\n,abc\n', 'Name,Name,Scryfall ID\nx,y,z\n']) {
    await expectStatus(await upload('alice', content), 400);
  }
  await expectStatus(await upload('alice', original, 'cards.txt'), 400);
  await expectStatus(await upload('alice', 'x'.repeat(10 * 1024 * 1024 + 1)), 413);

  for (const filename of ['../outside', '..\\outside', '/outside', 'link', {}, null]) {
    await expectStatus(await json('/search', { query: 'Original', filename }), 400);
    await expectStatus(await json('/multisearch', { terms: ['Original'], filename }), 400);
  }
  for (const filename of ['../outside.csv', '..\\outside.csv', 'link.csv', 'alice.txt']) {
    await expectStatus(await json(`/delete/${encodeURIComponent(filename)}`, {}, 'DELETE'), 400);
  }
  for (const query of [undefined, null, {}, 42, '', ' '.repeat(3), 'x'.repeat(201)]) {
    await expectStatus(await json('/search', { query }), 400);
  }
  for (const terms of [undefined, null, 'Original', [], [42], [''], Array(501).fill('Original')]) {
    await expectStatus(await json('/multisearch', { terms }), 400);
  }
  await expectStatus(await json('/search', { query: 'Original', filename: 'missing' }), 404);
  const all = await fetch(`http://127.0.0.1:${port}/files`).then(response => response.json());
  assert.deepEqual(all.map(row => row.filename), ['alice.csv']);
  for (const endpoint of ['/search', '/multisearch']) {
    const response = await json(endpoint, { query: 'Original', terms: ['Original'] });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).length, 1);
  }
  const accepted = await upload('Åsa Cards', '\uFEFFName,Scryfall ID\r\n"Card, name",id\r\n');
  assert.equal(accepted.status, 200, await accepted.text());
  assert.match(await fs.readFile(path.join(directory, 'textfiles/Åsa Cards.csv'), 'utf8'), /Card, name/);
  await fs.writeFile(path.join(directory, 'scryfall/scryfall.json'), 'invalid JSON');
  // A loaded snapshot remains available even if the cache file is subsequently damaged.
  const cached = await upload('alice', original);
  assert.equal(cached.status, 200, await cached.text());
  assert.equal((await fs.readdir(path.join(directory, 'textfiles'))).some(name => name.startsWith('.upload-')), false);
});


test('market prices preserve purchase prices, select foil prices, and drive search sorting', { timeout: 15000 }, async t => {
  const { port } = await startServer(t, 'test-secret');
  const form = new FormData();
  form.append('username', 'alice');
  form.append('file', new Blob(['Name,Scryfall ID,Foil,Purchase price\nRegular,original-id,normal,100\nFoil,original-id,foil,1\nUnknown,missing,normal,999\n']), 'cards.csv');
  const uploaded = await fetch(`http://127.0.0.1:${port}/upload`, {
    method: 'POST', headers: { password: 'test-secret' }, body: form,
  });
  assert.equal(uploaded.status, 200, await uploaded.text());
  const rows = await fetch(`http://127.0.0.1:${port}/files`).then(response => response.json());
  assert.deepEqual(rows.map(row => row.Name), ['Foil', 'Regular', 'Unknown']);
  assert.deepEqual(rows.map(row => row['Purchase price']), ['1', '100', '999']);
  assert.deepEqual(rows.map(row => row['Market price EUR']), ['5.00', '2.50', 'N/A']);
  const searched = await fetch(`http://127.0.0.1:${port}/multisearch`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ terms: ['Regular', 'Foil', 'Unknown'] }),
  }).then(response => response.json());
  assert.deepEqual(searched.map(row => row.Name), ['Foil', 'Regular', 'Unknown']);
});

test('collection metadata includes empty collections and browsing filters independently of search', { timeout: 15000 }, async t => {
  const { directory, port } = await startServer(t, 'test-secret');
  await fs.writeFile(path.join(directory, 'textfiles/alice.csv'),
    'Name,Scryfall ID,Market price EUR\n' + Array.from({ length: 12 }, (_, i) => `Card ${i},id,${i}`).join('\n') + '\n');
  await fs.writeFile(path.join(directory, 'textfiles/bob.csv'), 'Name,Scryfall ID\n');
  const get = endpoint => fetch(`http://127.0.0.1:${port}${endpoint}`);
  assert.deepEqual(await (await get('/collections')).json(), ['alice', 'bob']);
  assert.equal((await (await get('/files')).json()).length, 10);
  const selected = await (await get('/files?filename=alice')).json();
  assert.equal(selected.length, 12);
  assert.equal(selected[0].Name, 'Card 11');
  assert.deepEqual(await (await get('/files?filename=bob')).json(), []);
  assert.equal((await get('/files?filename=missing')).status, 404);
  assert.equal((await get('/files?filename=../outside')).status, 400);
  assert.equal((await get('/files?filename[]=alice')).status, 400);
  const empty = await fetch(`http://127.0.0.1:${port}/search`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'No matches' }),
  });
  assert.deepEqual(await empty.json(), []);
  assert.deepEqual(await (await get('/collections')).json(), ['alice', 'bob']);
});

test('surge foil imports use foil prices and preserve the original finish and purchase price', { timeout: 15000 }, async t => {
  const { port } = await startServer(t, 'test-secret');
  const form = new FormData();
  form.append('username', 'Surge collection');
  form.append('file', new Blob(['Name,Scryfall ID,Foil,Purchase price\nSurge card,original-id,Surge Foil,9.00\n']), 'cards.csv');
  const response = await fetch(`http://127.0.0.1:${port}/upload`, {
    method: 'POST', headers: { password: 'test-secret' }, body: form,
  });
  assert.equal(response.status, 200, await response.text());
  const rows = await fetch(`http://127.0.0.1:${port}/files`).then(r => r.json());
  assert.equal(rows[0]['Market price EUR'], '5.00');
  assert.equal(rows[0]['Purchase price'], '9.00');
  assert.equal(rows[0].Foil, 'Surge Foil');
});
