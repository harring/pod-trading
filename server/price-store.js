const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const axios = require('axios');

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
      if (!dataset?.download_uri) throw new Error('Scryfall default_cards download is unavailable.');
      const directory = await fs.promises.mkdtemp(path.join(path.dirname(filename), '.download-'));
      try {
        const staged = path.join(directory, 'scryfall.json');
        const download = await get(dataset.download_uri, { responseType: 'stream', timeout: 120000 });
        await pipeline(download.data, fs.createWriteStream(staged));
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

module.exports = { atomicWrite, createPriceStore, createCollectionLock };
