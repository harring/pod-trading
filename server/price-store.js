const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const axios = require('axios');
const { createGunzip } = require('node:zlib');
const { StringDecoder } = require('node:string_decoder');

async function* jsonlPrices(source) {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  let separator = '';
  const encode = line => {
    const card = JSON.parse(line);
    const result = separator + JSON.stringify({ id: card.id, prices: card.prices });
    separator = ',';
    return result;
  };
  yield '[';
  for await (const chunk of source) {
    pending += decoder.write(chunk);
    let newline;
    while ((newline = pending.indexOf('\n')) !== -1) {
      const line = pending.slice(0, newline).trim();
      pending = pending.slice(newline + 1);
      if (line) yield encode(line);
    }
  }
  pending += decoder.end();
  if (pending.trim()) yield encode(pending);
  yield ']';
}

// Staging beside the destination also works when data directories are mounted volumes.
async function atomicWrite(filename, contents) {
  const directory = await fs.promises.mkdtemp(path.join(path.dirname(filename), '.write-'));
  try {
    const staged = path.join(directory, 'data');
    await fs.promises.writeFile(staged, contents);
    await fs.promises.rename(staged, filename);
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
}

async function readIndex(filename) {
  const cards = JSON.parse(await fs.promises.readFile(filename, 'utf8'));
  if (!Array.isArray(cards) || !cards.length) throw new Error('Scryfall dataset must be a non-empty array.');
  const index = new Map();
  for (const card of cards) {
    if (!card || typeof card.id !== 'string' || !card.id || !card.prices ||
        !['eur', 'eur_foil'].every(key => card.prices[key] === null ||
          (typeof card.prices[key] === 'string' && /^\d+(\.\d+)?$/.test(card.prices[key])))) {
      throw new Error('Invalid Scryfall card or EUR price.');
    }
    index.set(card.id, { eur: card.prices.eur, eur_foil: card.prices.eur_foil });
  }
  return index;
}

function createPriceStore(filename, get = (...args) => axios.get(...args)) {
  let index;
  let loading;
  let refreshing;
  const refresh = () => {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      // Finish a pending startup read before publishing a newer snapshot.
      if (loading) await loading.catch(() => {});
      const response = await get('https://api.scryfall.com/bulk-data', { timeout: 30000 });
      const dataset = response.data?.data?.find(item => item.type === 'default_cards');
      const downloadUri = dataset?.jsonl_download_uri || dataset?.download_uri;
      if (!downloadUri) throw new Error('Scryfall default_cards download is unavailable.');
      const directory = await fs.promises.mkdtemp(path.join(path.dirname(filename), '.download-'));
      try {
        const staged = path.join(directory, 'scryfall.json');
        const download = await get(downloadUri, { responseType: 'stream', timeout: 120000, decompress: !dataset.jsonl_download_uri });
        if (dataset.jsonl_download_uri) {
          await pipeline(download.data, createGunzip(), jsonlPrices, fs.createWriteStream(staged));
        } else {
          await pipeline(download.data, fs.createWriteStream(staged));
        }
        const nextIndex = await readIndex(staged);
        await fs.promises.rename(staged, filename);
        index = nextIndex;
        return index;
      } finally {
        await fs.promises.rm(directory, { recursive: true, force: true });
      }
    })().finally(() => { refreshing = undefined; });
    return refreshing;
  };
  const snapshot = async () => {
    if (index) return index;
    if (refreshing) return refreshing;
    if (!loading) {
      loading = readIndex(filename).then(value => { index = value; return value; })
        .finally(() => { loading = undefined; });
    }
    try {
      return await loading;
    } catch {
      return refresh();
    }
  };
  return { snapshot, refresh };
}

function createCollectionLock() {
  const pending = new Map();
  return async (name, action) => {
    const previous = pending.get(name) || Promise.resolve();
    const current = previous.catch(() => {}).then(action);
    pending.set(name, current);
    try {
      return await current;
    } finally {
      if (pending.get(name) === current) pending.delete(name);
    }
  };
}

function marketPrice(row, prices) {
  const finish = String(row.Foil || '').toLowerCase().replace(/[\s_-]+/g, '');
  const card = prices.get(row['Scryfall ID']);
  const isFoil = finish === 'foil' || finish === 'surgefoil';
  return (isFoil ? card?.eur_foil : card?.eur) || 'N/A';
}

module.exports = { atomicWrite, createPriceStore, createCollectionLock, marketPrice };
