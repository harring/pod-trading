<template>
  <div>
    <!-- Logo and Website Name -->
    <div class="header">
      <img src="@/assets/logo.png" alt="Pod-Trading Logo" class="logo" />
      <h1 class="site-name">Pod-Trading</h1>
    </div>

    <!-- Search Input and Filename Dropdown -->
    <div style="display: flex; align-items: center;">
      <input v-model="searchQuery" placeholder="Search for a name..." />

      <!-- Dropdown for filtering by filename -->
      <select v-model="selectedFilename" @change="filterByFilename">
        <option value="">All Collections</option>
        <option v-for="file in uniqueFilenames" :key="file" :value="file">{{ file }}</option>
      </select>

      <!-- Upload and Delete buttons -->
      <button @click="showModal = true" class="upload-button">Upload Collection</button>
      <button @click="showDeleteModal = true" class="delete-button" :disabled="!selectedFilename">Delete Selected</button>
    </div>

    <!-- Table of Data -->
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Set Name</th>
          <th>Foil</th>
          <th>Rarity</th>
          <th>Language</th>
          <th>Collection</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, index) in filteredNames" :key="`${row.filename}-${index}`">
          <td>
            <a :href="`https://scryfall.com/cards/${row['Scryfall ID']}`" target="_blank">
              {{ row['Name'] }}
            </a>
          </td>
          <td>{{ row['Set name'] }}</td>
          <td>{{ row['Foil'] }}</td>
          <td>{{ row['Rarity'] }}</td>
          <td>{{ row['Language'] }}</td>
          <td>{{ row.filename.replace('.csv', '') }}</td>
        </tr>
      </tbody>
    </table>

    <!-- Modal Popup for File Upload -->
    <div v-if="showModal" class="modal">
      <div class="modal-content">
        <h3>Upload a CSV File</h3>
        <form @submit.prevent="uploadFile">
          <label for="username">Enter your name:</label>
          <input type="text" v-model="username" required />
          <br /><br />

          <label for="file">Choose CSV file:</label>
          <input type="file" @change="onFileChange" accept=".csv" required />
          <br /><br />

          <label for="password">Enter password:</label>
          <input type="password" v-model="password" required />
          <br /><br />

          <button type="submit">Upload</button>
          <button type="button" @click="showModal = false">Cancel</button>
        </form>
      </div>
    </div>

    <!-- Modal Popup for File Delete -->
    <div v-if="showDeleteModal" class="modal">
      <div class="modal-content">
        <h3>Delete Selected CSV File</h3>
        <form @submit.prevent="deleteCSV">
          <p>Are you sure you want to delete <strong>{{ selectedFilename }}</strong>?</p>

          <label for="password">Enter password:</label>
          <input type="password" v-model="password" required />
          <br /><br />

          <button type="submit">Delete</button>
          <button type="button" @click="showDeleteModal = false">Cancel</button>
        </form>
      </div>
    </div>
  </div>
</template>


<script>
export default {
  data() {
    return {
      searchQuery: '',
      names: [],
      file: null, // File to upload
      username: '', // User input for file name
      password: '', // Password input for file operations
      showModal: false, // Controls the modal visibility for upload
      showDeleteModal: false, // Controls the modal visibility for delete
      selectedFilename: '', // Selected filename for filtering
    };
  },
  computed: {
    filteredNames() {
      let filtered = this.names;

      // Apply search filter
      if (this.searchQuery) {
        const query = this.searchQuery.toLowerCase();
        filtered = filtered.filter(row =>
          row['Name'] && row['Name'].toLowerCase().includes(query)
        );
      }

      // Apply filename filter
      if (this.selectedFilename) {
        filtered = filtered.filter(row => row.filename === this.selectedFilename + '.csv');
      }

      return filtered;
    },

    // Get unique filenames for dropdown options
    uniqueFilenames() {
      const filenames = this.names.map(row => row.filename.replace('.csv', ''));
      return [...new Set(filenames)];
    }
  },
  methods: {
    fetchNames() {
      fetch('/files')
        .then(response => response.json())
        .then(data => {
          this.names = data;
        })
        .catch(error => {
          console.error('Error fetching data:', error);
        });
    },
    onFileChange(event) {
      this.file = event.target.files[0];
    },
    uploadFile() {
  if (!this.file || !this.username || !this.password) {
    alert('Please fill in all fields.');
    return;
  }

  const formData = new FormData();
  formData.append('file', this.file);
  formData.append('username', this.username);
  formData.append('password', this.password); // Include password

  fetch('/upload', {
    method: 'POST',
    body: formData,
  })
    .then(response => response.json()) // Parse the JSON response
    .then(data => {
      if (data.message) {
        alert(data.message); // Display the message from the backend
        this.fetchNames(); // Refresh the table after upload
        this.showModal = false; // Close the modal after upload
      } else {
        alert('File upload failed.'); // Fallback if no message is received
      }
    })
    .catch(error => {
      console.error('Error uploading file:', error);
      alert('File upload failed.');
    });
},
deleteCSV() {
  if (!this.password) {
    alert('Please enter the password.');
    return;
  }

  const filename = `${this.selectedFilename}.csv`;
  fetch(`/delete/${filename}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password: this.password }) // Include password
  })
    .then(response => response.json()) // Parse the JSON response
    .then(data => {
      if (data.message) {
        alert(data.message); // Display the message from the backend
        this.fetchNames(); // Refresh the table after deletion
        this.selectedFilename = ''; // Reset the selected file
        this.showDeleteModal = false; // Close the modal after deletion
      } else {
        alert('Failed to delete file.');
      }
    })
    .catch(error => {
      console.error('Error deleting file:', error);
      alert('File deletion failed.');
    });
},
    filterByFilename() {
      // This method is automatically handled by the computed property `filteredNames`
    }
  },
  mounted() {
    this.fetchNames();
  },
};
</script>

<style scoped>
/* Add some basic styling */
.header {
  display: flex;
  align-items: center;
  padding: 10px;
}

.logo {
  width: 50px;
  height: 50px;
  margin-right: 10px;
}

.site-name {
  font-size: 24px;
  font-weight: bold;
}

table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 10px;
}

th, td {
  border: 1px solid #ccc;
  padding: 8px;
  text-align: left;
}

th {
  background-color: #f2f2f2;
}

tbody tr:nth-child(even) {
  background-color: #f9f9f9;
}

a {
  color: #3498db;
  text-decoration: none;
}

a:hover {
  text-decoration: underline;
}

/* Upload Button */
.upload-button {
  margin-left: 10px;
  padding: 10px 20px;
  background-color: #3498db;
  color: white;
  border: none;
  cursor: pointer;
}

.upload-button:hover {
  background-color: #2980b9;
}

/* Delete Button */
.delete-button {
  margin-left: 10px;
  padding: 10px 20px;
  background-color: #e74c3c;
  color: white;
  border: none;
  cursor: pointer;
}

.delete-button:hover {
  background-color: #c0392b;
}

/* Modal Styling */
.modal {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
}

.modal-content {
  background-color: white;
  padding: 20px;
  border-radius: 8px;
  width: 400px;
  text-align: center;
}

.modal-content h3 {
  margin-bottom: 20px;
}

.modal-content button {
  margin-top: 10px;
}

</style>
