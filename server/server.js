const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');

dotenv.config()

const app = express();
const PORT = process.env.PORT || 3000;

// Set the password to whats in the .env file, fallback to "harring" if no password
const PASSWORD = process.env.SECRET || 'harring'

// Ensure the 'textfiles' directory exists
const textFilesDirectory = path.join(__dirname, 'textfiles');
if (!fs.existsSync(textFilesDirectory)) {
  fs.mkdirSync(textFilesDirectory);
  console.log('Created textfiles directory');
}

// Parse URL-encoded bodies (for form data)
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Setup multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'textfiles/'); // Save the file to the 'textfiles' directory
  },
  filename: function (req, file, cb) {
    // Set the filename to the user's provided name with .csv extension
    cb(null, `${req.body.username || 'temp'}.csv`);
  }
});

const upload = multer({ storage: storage });

// Middleware to check password
function verifyPassword(req, res, next) {
  const password = req.body.password || req.headers['password']; // FormData uses body for multipart requests

  if (!password || password !== PASSWORD) {
    return res.status(403).send('Incorrect password');
  }

  next(); // Proceed to the next middleware if password is correct
}

// Delete CSV file
app.delete('/delete/:filename', verifyPassword, (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(__dirname, 'textfiles', filename);

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

    // If there are no files, send an empty response immediately
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

app.post('/upload', (req, res, next) => {
  // First process the file upload with multer
  upload.single('file')(req, res, function (err) {
    if (err) {
      return res.status(400).json({ message: 'File upload failed.' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded.' });
    }

    if (!req.body.username) {
      return res.status(400).json({ message: 'No username provided.' });
    }

    // Verify password after multer processes form data
    const password = req.body.password || req.headers['password'];
    if (!password || password !== PASSWORD) {
      return res.status(403).send('Incorrect password');
    }

    // Rename the file after upload using the username
    const newFileName = `${req.body.username}.csv`;
    const oldFilePath = path.join(textFilesDirectory, req.file.filename);
    const newFilePath = path.join(textFilesDirectory, newFileName);

    fs.rename(oldFilePath, newFilePath, (renameErr) => {
      if (renameErr) {
        return res.status(500).json({ message: 'Error renaming the file.' });
      }

      res.json({ message: 'File uploaded successfully!', filename: newFileName });
    });
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
