const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const dotenv = require('dotenv');
const csv = require('csv-parser');
const { parse } = require('json2csv');
const { atomicWrite, createPriceStore, createCollectionLock } = require('./price-store');
const cron = require('node-cron');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

const PASSWORD = process.env.SECRET;
if (!PASSWORD || !PASSWORD.trim()) {
  throw new Error('SECRET must be set to a non-empty password.');
}
const textFilesDirectory = path.join(__dirname, 'textfiles');
const scryfallDirectory = path.join(__dirname, 'scryfall');
const scryfallFilePath = path.join(scryfallDirectory, 'scryfall.json');

if (!fs.existsSync(textFilesDirectory)) fs.mkdirSync(textFilesDirectory);
if (!fs.existsSync(scryfallDirectory)) fs.mkdirSync(scryfallDirectory);

const priceStore = createPriceStore(scryfallFilePath);
const withCollection = createCollectionLock();
let updatingPrices;
const updateAllCSVFiles = () => {
  if (updatingPrices) return updatingPrices;
  updatingPrices = (async () => {
    await priceStore.refresh();
    for (const name of listCollections()) {
      try {
        await withCollection(name, () => updateCSVWithScryfallPrices(collectionPath(name)));
      } catch (error) {
        console.error(`Failed to update collection ${name}:`, error);
      }
    }
  })().catch(error => console.error('Failed to refresh Scryfall prices:', error))
    .finally(() => { updatingPrices = undefined; });
  return updatingPrices;
};

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const badRequest = message => Object.assign(new Error(message), { status: 400 });
const validName = name => typeof name === 'string' && name.length <= 80 &&
  /^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u.test(name) && name === name.trim();

// Names are collection IDs, never paths. Reject symlinks as well as traversal.
const collectionPath = name => {
  if (!validName(name)) throw badRequest('Collection names must be 1–80 letters, numbers, spaces, underscores or hyphens, starting with a letter or number.');
  const target = path.resolve(textFilesDirectory, `${name}.csv`);
  if (path.dirname(target) !== textFilesDirectory) throw badRequest('Invalid collection path.');
  try {
    if (!fs.lstatSync(target).isFile()) throw badRequest('Collection must be a regular file.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return target;
};
const listCollections = () => fs.readdirSync(textFilesDirectory, { withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.endsWith('.csv') && validName(entry.name.slice(0, -4)))
  .map(entry => entry.name.slice(0, -4));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 2, parts: 3, fieldSize: 1024 },
  fileFilter: (req, file, cb) => cb(
    path.extname(file.originalname).toLowerCase() === '.csv' ? null : badRequest('Upload a .csv file.'), true),
});

async function readRows(source, validate = false) {
  const rows = [];
  const parser = csv({ strict: true, maxRowBytes: 64 * 1024,
    mapHeaders: ({ header, index }) => index === 0 ? header.replace(/^\uFEFF/, '') : header });
  parser.on('headers', headers => {
    if (validate && (!['Name', 'Scryfall ID'].every(key => headers.includes(key)) ||
        new Set(headers).size !== headers.length || headers.some(header => !header.trim()))) {
      parser.destroy(badRequest('CSV requires unique, non-empty headers including Name and Scryfall ID.'));
    }
  });
  try {
    await pipeline(source, parser, async parsed => {
      for await (const row of parsed) {
        if (validate && (!row.Name?.trim() || !row['Scryfall ID']?.trim())) {
          throw badRequest('Each CSV row requires Name and Scryfall ID.');
        }
        rows.push(row);
      }
    });
  } catch (error) {
    if (validate) throw badRequest(error.status === 400 ? error.message : 'Invalid CSV structure or row exceeds 64 KiB.');
    throw error;
  }
  if (validate && !rows.length) throw badRequest('CSV must contain at least one card.');
  return rows;
}
const route = handler => (req, res, next) => Promise.resolve().then(() => handler(req, res)).catch(next);
const byPrice = (a, b) => (parseFloat(b['Market price EUR']) || 0) - (parseFloat(a['Market price EUR']) || 0);

const verifyPassword = (req, res, next) => {
  const password = req.body?.password || req.headers['password'];
  if (password !== PASSWORD) return res.status(403).json({ message: 'Incorrect password' });
  next();
};

const updateCSVWithScryfallPrices = async (csvFilePath) => {
  const updatedRows = [];
  const prices = await priceStore.snapshot();

  const rows = await readRows(fs.createReadStream(csvFilePath));
  for (const row of rows) {
    const card = prices.get(row['Scryfall ID']);
    const price = row.Foil?.toLowerCase() === 'foil' ? card?.eur_foil : card?.eur;
    row['Market price EUR'] = price || 'N/A';
    updatedRows.push(row);
  }
  updatedRows.sort(byPrice);
  await atomicWrite(csvFilePath, parse(updatedRows));
};

app.get('/collections', route(async (req, res) => {
  res.json(listCollections().sort((a, b) => a.localeCompare(b)));
}));

app.get('/files', route(async (req, res) => {
  const { filename } = req.query;
  if (filename !== undefined && filename !== '') collectionPath(filename);
  const names = filename ? [filename] : listCollections();
  const results = await Promise.all(names.map(async name => {
    const rows = await readRows(fs.createReadStream(collectionPath(name)));
    const sorted = rows.sort(byPrice);
    return (filename ? sorted : sorted.slice(0, 10)).map(row => ({ ...row, filename: `${name}.csv` }));
  }));
  res.json(results.flat());
}));

const search = exact => route(async (req, res) => {
  const { query, terms, filename } = req.body || {};
  if (filename !== undefined && filename !== '') collectionPath(filename);
  const validTerm = term => typeof term === 'string' && term.trim().length > 0 && term.length <= 200;
  if (exact ? (!Array.isArray(terms) || !terms.length || terms.length > 500 || !terms.every(validTerm)) : !validTerm(query)) {
    throw badRequest(exact ? 'Provide 1–500 search terms, each 1–200 characters.' : 'Query must be a string of 1–200 characters.');
  }
  const names = filename ? [filename] : listCollections();
  const termSet = exact ? new Set(terms.map(term => term.trim().toLowerCase())) : null;
  const results = await Promise.all(names.map(async name => {
    const rows = await readRows(fs.createReadStream(collectionPath(name)));
    return rows.filter(row => row.Name && (exact ? termSet.has(row.Name.toLowerCase()) :
      row.Name.toLowerCase().includes(query.trim().toLowerCase())))
      .map(row => ({ ...row, filename: name }));
  }));
  res.json(results.flat().sort(byPrice));
});
app.post('/search', search(false));
app.post('/multisearch', search(true));

app.post('/upload', verifyPassword, upload.single('file'), route(async (req, res) => {
  if (!req.file) throw badRequest('No file uploaded.');
  collectionPath(req.body.username);
  const rows = await readRows(Readable.from([req.file.buffer]), true);
  await withCollection(req.body.username, async () => {
    const prices = await priceStore.snapshot();
    for (const row of rows) {
      const card = prices.get(row['Scryfall ID']);
      row['Market price EUR'] = (row.Foil?.toLowerCase() === 'foil' ? card?.eur_foil : card?.eur) || 'N/A';
    }
    await atomicWrite(collectionPath(req.body.username), parse(rows.sort(byPrice)));
  });
  res.json({ message: 'File uploaded and prices updated successfully!' });
}));

app.delete('/delete/:filename', verifyPassword, route(async (req, res) => {
  if (!req.params.filename.endsWith('.csv')) throw badRequest('Collection filename must end in .csv.');
  const name = req.params.filename.slice(0, -4);
  await withCollection(name, () => fs.promises.unlink(collectionPath(name)));
  res.json({ message: 'File deleted successfully.' });
}));

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error instanceof multer.MulterError ? (error.code === 'LIMIT_FILE_SIZE' ? 413 : 400) :
    error.code === 'ENOENT' ? 404 : error.status || 500;
  const message = status === 413 ? 'Upload exceeds the 10 MiB file limit or request body is too large.' :
    status === 404 ? 'Collection not found.' : status >= 500 ? 'Unable to complete request.' : error.message;
  if (status >= 500) console.error(error);
  res.status(status).json({ message });
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

priceStore.snapshot().catch(error => console.error('Scryfall prices are unavailable:', error));
cron.schedule('0 10 * * *', updateAllCSVFiles, { timezone: 'UTC' });

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
