const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for all routes
app.use(cors());

// Parse URL-encoded bodies (for form data)
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Setup multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'textfiles/'); // Save the file to the 'textfiles' directory
  },
  filename: function (req, file, cb) {
    // At this point, req.body.username may not be available. 
    // So we will set the filename after the fields have been processed.
    cb(null, 'temp.csv');  // Temporarily store with a temp name.
  }
});

const upload = multer({ storage: storage });

// Serve the existing CSV files
app.get('/files', (req, res) => {
  const directoryPath = path.join(__dirname, 'textfiles');

  fs.readdir(directoryPath, (err, files) => {
    if (err) {
      return res.status(500).send('Unable to scan directory');
    }

    let dataRows = [];
    let fileCount = files.length;
    
    // If there are no files, send an empty response immediately
    if (fileCount === 0) {
      return res.json(dataRows);
    }

    files.forEach((file) => {
      const filePath = path.join(directoryPath, file);
      const csv = require('csv-parser');

      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (row) => {
          dataRows.push({ ...row, filename: file });
        })
        .on('end', () => {
          fileCount -= 1;

          // Only send the response when all files have been processed
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

// Handle file uploads using upload.single() to capture file and form data
app.post('/upload', (req, res, next) => {
  // First process the file upload with multer
  upload.single('file')(req, res, function (err) {
    if (err) {
      return res.status(400).send('File upload failed.');
    }

    if (!req.file) {
      return res.status(400).send('No file uploaded.');
    }

    if (!req.body.username) {
      return res.status(400).send('No username provided.');
    }

    // Rename the file after upload using the username
    const newFileName = `${req.body.username}.csv`;
    const oldFilePath = path.join(__dirname, 'textfiles', req.file.filename);
    const newFilePath = path.join(__dirname, 'textfiles', newFileName);

    fs.rename(oldFilePath, newFilePath, (renameErr) => {
      if (renameErr) {
        return res.status(500).send('Error renaming the file.');
      }

      res.json({ message: 'File uploaded successfully!', filename: newFileName });
    });
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
