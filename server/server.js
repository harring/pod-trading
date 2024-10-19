const express = require('express');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for all routes
app.use(cors());

app.get('/files', (req, res) => {
  const directoryPath = path.join(__dirname, 'textfiles');

  fs.readdir(directoryPath, (err, files) => {
    if (err) {
      return res.status(500).send('Unable to scan directory');
    }

    let dataRows = [];
    let pendingFiles = files.length;

    if (pendingFiles === 0) {
      return res.json(dataRows);
    }

    // Process each file
    files.forEach((file) => {
      const filePath = path.join(directoryPath, file);
      let rowIndex = 0;

      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (row) => {
          row['filename'] = file; // Add the filename to each row
          row['rowIndex'] = rowIndex++; // Add the row number to each row
          dataRows.push(row);
        })
        .on('end', () => {
          pendingFiles--;
          if (pendingFiles === 0) {
            res.json(dataRows); // Send all data once all files are processed
          }
        })
        .on('error', (error) => {
          return res.status(500).send(`Error reading file ${file}: ${error.message}`);
        });
    });
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
