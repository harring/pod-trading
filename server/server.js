const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const dotenv = require('dotenv');
const csv = require('csv-parser');
const { parse } = require('json2csv');
const axios = require('axios');
const cron = require('node-cron');

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

const PASSWORD = process.env.SECRET || 'harring';
const textFilesDirectory = path.join(__dirname, 'textfiles');
const scryfallDirectory = path.join(__dirname, 'scryfall');
const scryfallFilePath = path.join(scryfallDirectory, 'scryfall.json');

if (!fs.existsSync(textFilesDirectory)) fs.mkdirSync(textFilesDirectory);
if (!fs.existsSync(scryfallDirectory)) fs.mkdirSync(scryfallDirectory);

const downloadScryfallData = async () => {
  try {
    const response = await axios.get('https://api.scryfall.com/bulk-data');
    const defaultCardsData = response.data.data.find(item => item.type === 'default_cards');
    if (defaultCardsData?.download_uri) {
      const downloadResponse = await axios.get(defaultCardsData.download_uri, { responseType: 'stream' });
      const writeStream = fs.createWriteStream(scryfallFilePath);
      downloadResponse.data.pipe(writeStream);
      writeStream.on('finish', updateAllCSVFiles);
    }
  } catch (error) {
    console.error('Failed to download Scryfall data:', error);
  }
};

const updateAllCSVFiles = async () => {
  const files = fs.readdirSync(textFilesDirectory);
  for (const file of files) {
    await updateCSVWithScryfallPrices(path.join(textFilesDirectory, file));
  }
};

if (!fs.existsSync(scryfallFilePath)) downloadScryfallData();
cron.schedule('0 10 * * *', downloadScryfallData, { timezone: 'UTC' });

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'textfiles/'),
  filename: (req, file, cb) => cb(null, `${req.body.username || 'temp'}.csv`)
});
const upload = multer({ storage });

const verifyPassword = (req, res, next) => {
  const password = req.body.password || req.headers['password'];
  if (password !== PASSWORD) return res.status(403).json({ message: 'Incorrect password' });
  next();
};

const updateCSVWithScryfallPrices = async (csvFilePath) => {
  const updatedRows = [];
  const scryfallData = JSON.parse(fs.readFileSync(scryfallFilePath, 'utf-8'));

  return new Promise((resolve, reject) => {
    fs.createReadStream(csvFilePath)
      .pipe(csv())
      .on('data', (row) => {
        const scryfallCard = scryfallData.find(card => card.id === row['Scryfall ID']);
        if (scryfallCard) {
          const isFoil = row['Foil'] && row['Foil'].toLowerCase() === 'foil';
          const price = isFoil ? scryfallCard.prices.eur_foil : scryfallCard.prices.eur;
          if (price) row['Purchase price'] = price;
        }
        updatedRows.push(row);
      })
      .on('end', () => {
        updatedRows.sort((a, b) => parseFloat(b['Purchase price']) - parseFloat(a['Purchase price']));
        const csvOutput = parse(updatedRows);
        fs.writeFileSync(csvFilePath, csvOutput);
        resolve('CSV updated successfully');
      })
      .on('error', (error) => reject(error));
  });
};

// Endpoint to retrieve the top 10 most expensive items from each CSV
app.get('/files', (req, res) => {
  fs.readdir(textFilesDirectory, (err, files) => {
    if (err) return res.status(500).json({ message: 'Unable to scan directory' });

    let fileCount = files.length;
    const fileData = [];

    if (fileCount === 0) return res.json(fileData);

    files.forEach((file) => {
      const filePath = path.join(textFilesDirectory, file);
      const fileRows = [];

      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (row) => fileRows.push(row))
        .on('end', () => {
          fileRows.sort((a, b) => parseFloat(b['Purchase price']) - parseFloat(a['Purchase price']));
          fileData.push(...fileRows.slice(0, 10).map(row => ({ ...row, filename: file })));
          if (--fileCount === 0) res.json(fileData);
        })
        .on('error', (error) => res.status(500).json({ message: `Error reading file ${file}: ${error.message}` }));
    });
  });
});

// Endpoint for multisearch
app.post('/multisearch', (req, res) => {
  const { terms, filename } = req.body;
  const searchTerms = terms.map(term => term.toLowerCase());

  const searchFileExact = (filePath, filename) => {
    return new Promise((resolve, reject) => {
      const fileResults = [];

      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (row) => {
          if (row['Name'] && searchTerms.includes(row['Name'].toLowerCase())) {
            fileResults.push({ ...row, filename });
          }
        })
        .on('end', () => resolve(fileResults))
        .on('error', (error) => reject(error));
    });
  };

  const sortResultsByPrice = (results) => {
    return results.sort((a, b) => {
      const priceA = parseFloat(a['Purchase price']) || 0;
      const priceB = parseFloat(b['Purchase price']) || 0;
      return priceB - priceA;
    });
  };

  if (filename) {
    const filePath = path.join(textFilesDirectory, `${filename}.csv`);
    searchFileExact(filePath, filename)
      .then(fileResults => res.json(sortResultsByPrice(fileResults)))
      .catch(error => res.status(500).json({ message: `Error in multisearch on file ${filename}: ${error.message}` }));
  } else {
    fs.readdir(textFilesDirectory, (err, files) => {
      if (err) return res.status(500).json({ message: 'Unable to scan directory' });

      Promise.all(files.map((file) => {
        const filePath = path.join(textFilesDirectory, file);
        return searchFileExact(filePath, file.replace('.csv', ''));
      }))
      .then(results => res.json(sortResultsByPrice(results.flat())))
      .catch(error => res.status(500).json({ message: `Error in multisearch across files: ${error.message}` }));
    });
  }
});

// Endpoint to search within a specific file or all files
app.post('/search', (req, res) => {
  const { query, filename } = req.body;

  // Define function to search within a file
  const searchFile = (filePath, filename) => {
    return new Promise((resolve, reject) => {
      const fileResults = [];

      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (row) => {
          // Perform a case-insensitive search on the 'Name' field
          if (row['Name'] && row['Name'].toLowerCase().includes(query.toLowerCase())) {
            fileResults.push({ ...row, filename });
          }
        })
        .on('end', () => resolve(fileResults))
        .on('error', (error) => reject(error));
    });
  };

  // Helper function to sort results by Purchase price in descending order
  const sortResultsByPrice = (results) => {
    return results.sort((a, b) => {
      const priceA = parseFloat(a['Purchase price']) || 0;
      const priceB = parseFloat(b['Purchase price']) || 0;
      return priceB - priceA;
    });
  };

  // If a specific filename is provided, search only in that file
  if (filename) {
    const filePath = path.join(textFilesDirectory, `${filename}.csv`);
    searchFile(filePath, filename)
      .then((fileResults) => res.json(sortResultsByPrice(fileResults)))
      .catch((error) => res.status(500).json({ message: `Error searching file ${filename}: ${error.message}` }));
  } else {
    // Otherwise, search across all files
    fs.readdir(textFilesDirectory, (err, files) => {
      if (err) return res.status(500).json({ message: 'Unable to scan directory' });

      Promise.all(files.map((file) => {
        const filePath = path.join(textFilesDirectory, file);
        return searchFile(filePath, file.replace('.csv', ''));
      }))
      .then((results) => {
        // Flatten results from all files, sort by price across all results, and send them
        res.json(sortResultsByPrice(results.flat()));
      })
      .catch((error) => res.status(500).json({ message: `Error searching files: ${error.message}` }));
    });
  }
});

app.post('/upload', upload.single('file'), verifyPassword, async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No file uploaded.' });

  const filePath = path.join(textFilesDirectory, req.file.filename);
  try {
    await updateCSVWithScryfallPrices(filePath);
    res.json({ message: 'File uploaded and prices updated successfully!' });
  } catch (error) {
    console.error('Error updating prices:', error);
    res.status(500).json({ message: 'File uploaded but failed to update prices.' });
  }
});


app.delete('/delete/:filename', verifyPassword, (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(textFilesDirectory, filename);

  fs.unlink(filePath, (err) => {
    if (err) return res.status(500).json({ message: `Error deleting file ${filename}: ${err.message}` });
    res.json({ message: 'File deleted successfully.' });
  });
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
