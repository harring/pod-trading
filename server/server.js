const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const csv = require('csv-parser');
const { parse } = require('json2csv');
const axios = require('axios');
const cron = require('node-cron'); // For scheduling jobs

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to log every request
app.use((req, res, next) => {
  console.log(`Received ${req.method} request for ${req.url}`);
  
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    console.log('Request body:', req.body);
  }
  
  next(); // Continue to the next middleware or route handler
});

// Set the password to whats in the .env file, fallback to "harring" if no password
const PASSWORD = process.env.SECRET || 'harring';

// Ensure the 'textfiles' and 'scryfall' directories exist
const textFilesDirectory = path.join(__dirname, 'textfiles');
const scryfallDirectory = path.join(__dirname, 'scryfall');
const scryfallFilePath = path.join(scryfallDirectory, 'scryfall.json');

if (!fs.existsSync(textFilesDirectory)) {
  fs.mkdirSync(textFilesDirectory);
  console.log('Created textfiles directory');
}

if (!fs.existsSync(scryfallDirectory)) {
  fs.mkdirSync(scryfallDirectory);
  console.log('Created scryfall directory');
}

// Function to download the Scryfall bulk data
const downloadScryfallData = async () => {
  try {
    console.log('Downloading Scryfall data...');
    const bulkDataUrl = 'https://api.scryfall.com/bulk-data';
    const response = await axios.get(bulkDataUrl);
    
    const defaultCardsData = response.data.data.find(item => item.type === 'default_cards');
    
    if (defaultCardsData && defaultCardsData.download_uri) {
      const downloadResponse = await axios.get(defaultCardsData.download_uri, { responseType: 'stream' });
      const writeStream = fs.createWriteStream(scryfallFilePath);

      downloadResponse.data.pipe(writeStream);
      
      writeStream.on('finish', async () => {
        console.log('Scryfall data downloaded successfully!');
        await updateAllCSVFiles(); // Update all CSV files after the Scryfall data is downloaded
      });
      
      writeStream.on('error', (err) => {
        console.error('Error downloading Scryfall data:', err);
      });
    }
  } catch (error) {
    console.error('Failed to download Scryfall data:', error);
  }
};

// Function to update all CSV files in the 'textfiles' directory
const updateAllCSVFiles = async () => {
  try {
    console.log('Updating all CSV files...');
    const files = fs.readdirSync(textFilesDirectory);

    for (const file of files) {
      const filePath = path.join(textFilesDirectory, file);
      await updateCSVWithScryfallPrices(filePath);
    }

    console.log('All CSV files updated successfully!');
  } catch (error) {
    console.error('Error updating CSV files:', error);
  }
};

// Automatically download the scryfall.json file if it doesn't exist
if (!fs.existsSync(scryfallFilePath)) {
  console.log('scryfall.json file not found, downloading...');
  downloadScryfallData();
}

// Schedule the Scryfall data update to run every day at 10:00 UTC
cron.schedule('0 10 * * *', () => {
  console.log('Scheduled task: downloading new Scryfall data...');
  downloadScryfallData();
}, {
  timezone: 'UTC',
});

// Parse URL-encoded bodies (for form data)
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Setup multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'textfiles/'); // Save the file to the 'textfiles' directory
  },
  filename: function (req, file, cb) {
    cb(null, `${req.body.username || 'temp'}.csv`);
  }
});

const upload = multer({ storage: storage });

// Middleware to check password
function verifyPassword(req, res, next) {
  const password = req.body.password || req.headers['password'];

  if (!password || password !== PASSWORD) {
    return res.status(403).send('Incorrect password');
  }

  next(); // Proceed to the next middleware if password is correct
}

// Function to update CSV purchase prices based on Scryfall data
const updateCSVWithScryfallPrices = async (csvFilePath) => {
  return new Promise((resolve, reject) => {
    const updatedRows = [];
    const scryfallData = JSON.parse(fs.readFileSync(scryfallFilePath, 'utf-8'));

    fs.createReadStream(csvFilePath)
      .pipe(csv())
      .on('data', (row) => {
        const scryfallCard = scryfallData.find(card => card.id === row['Scryfall ID']);

        if (scryfallCard) {
          // Check if the card is foil based on the CSV file
          const isFoil = row['Foil'] && row['Foil'].toLowerCase() === 'foil';

          // Select the correct price based on whether it's foil
          const price = isFoil ? scryfallCard.prices.eur_foil : scryfallCard.prices.eur;

          // If a price is found, update the Purchase price
          if (price) {
            row['Purchase price'] = price;
          }
        }

        updatedRows.push(row);
      })
      .on('end', () => {
        // Convert the updatedRows back to CSV format
        const csvOutput = parse(updatedRows);
        fs.writeFileSync(csvFilePath, csvOutput); // Write updated CSV to the same file
        resolve('CSV updated successfully');
      })
      .on('error', (error) => {
        reject(error);
      });
  });
};

// Delete CSV file
app.delete('/delete/:filename', verifyPassword, (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(textFilesDirectory, filename);

  fs.unlink(filePath, (err) => {
    if (err) {
      return res.status(500).json({ message: `Error deleting file ${filename}: ${err.message}` });
    }
    res.status(200).json({ message: 'File deleted successfully.' });
  });
});

// Serve the existing CSV files
app.get('/files', (req, res) => {
  fs.readdir(textFilesDirectory, (err, files) => {
    if (err) {
      return res.status(500).send('Unable to scan directory');
    }

    let dataRows = [];
    let fileCount = files.length;

    if (fileCount === 0) {
      return res.json(dataRows);
    }

    files.forEach((file) => {
      const filePath = path.join(textFilesDirectory, file);
      const csv = require('csv-parser');

      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (row) => {
          dataRows.push({ ...row, filename: file });
        })
        .on('end', () => {
          fileCount -= 1;

          if (fileCount === 0) {
            res.json(dataRows);
          }
        })
        .on('error', (error) => {
          return res.status(500).send(`Error reading file ${file}: ${error.message}`);
        });
    });
  });
});

app.post('/upload', async (req, res, next) => {
  console.log('Received an upload request');
  
  // Use multer to handle the file upload
  upload.single('file')(req, res, async function (err) {
    if (err) {
      console.error('File upload error:', err); // Log the error
      return res.status(400).json({ message: 'File upload failed.' }); // Return JSON error
    }

    if (!req.file) {
      console.error('No file was uploaded.');
      return res.status(400).json({ message: 'No file uploaded.' }); // Return JSON error
    }

    if (!req.body.username) {
      console.error('No username provided.');
      return res.status(400).json({ message: 'No username provided.' }); // Return JSON error
    }

    // Check the password after multer processes the form data
    const password = req.body.password;
    if (!password || password !== PASSWORD) {
      console.error('Incorrect password');
      return res.status(403).json({ message: 'Incorrect password' });
    }

    console.log('File uploaded:', req.file);
    console.log('Username:', req.body.username);

    // Continue with renaming the file
    const newFileName = `${req.body.username}.csv`;
    const oldFilePath = path.join(textFilesDirectory, req.file.filename);
    const newFilePath = path.join(textFilesDirectory, newFileName);

    try {
      fs.renameSync(oldFilePath, newFilePath); // Rename file

      // Immediately return a response to the client indicating the file was uploaded
      res.json({ message: 'File uploaded successfully! Prices will be updated within the next minute.', filename: newFileName });

      // Perform the price update in the background
      await updateCSVWithScryfallPrices(newFilePath); // Update prices in the background
      console.log(`Prices updated for file: ${newFileName}`);
    } catch (error) {
      console.error('Error processing file:', error.message);
      // If the price update fails, log the error, but do not block the response
    }
  });
});

// Serve the static frontend files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Fallback route to serve the Vue.js app
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
