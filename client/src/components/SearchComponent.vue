<template>
  <div>
    <div class="header">
      <img src="@/assets/logo.png" alt="Pod-Trading Logo" class="logo" />
      <h1 class="site-name">Pod-Trading</h1>
    </div>

    <div style="display: flex; align-items: center;">
      <input v-model="searchQuery" placeholder="Search for a name..." @keyup.enter="searchItems" />
      <select v-model="selectedFilename">
        <option value="">All Collections</option>
        <option v-for="file in uniqueFilenames" :key="file" :value="file">{{ file }}</option>
      </select>
      <button @click="showMultiSearchModal = true" class="multisearch-button">Multisearch</button>
      <button @click="showModal = true" class="upload-button">Upload Collection</button>
      <button @click="showDeleteModal = true" class="delete-button" :disabled="!selectedFilename">Delete
        Selected</button>
    </div>

    <!-- Loading Indicator -->
    <div v-if="loading" class="loading-indicator">
      <p>Loading, please wait...</p>
    </div>

    <table v-else>
      <thead>
        <tr>
          <th>Name</th>
          <th>Set Name</th>
          <th>Rarity</th>
          <th>Language</th>
          <th>Collection</th>
          <th>CM 7 day avg</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, index) in names" :key="`${row.filename}-${index}`">
          <td><a :href="`https://scryfall.com/cards/${row['Scryfall ID']}`" target="_blank">{{ row['Name'] }}</a></td>
          <td>{{ row['Set name'] }}</td>
          <td>{{ row['Rarity'] }}{{ row['Foil'] === 'foil' ? ' foil' : '' }}</td>
          <td>{{ row['Language'] }}</td>
          <td>{{ row.filename.replace('.csv', '') }}</td>
          <td>{{ row['Purchase price'] ? row['Purchase price'] + ' €' : 'N/A' }}</td>
        </tr>
      </tbody>
    </table>

    <!-- Modal Popup for multisearch -->
    <div v-if="showMultiSearchModal" class="modal">
      <div class="modal-content">
        <h3>Multisearch</h3>
        <p>Copy and paste a decklist in moxfield, MTGA or MTGO format.</p>
        <form @submit.prevent="performMultiSearch">
          <label for="terms">Paste terms (one per line):</label>
          <textarea v-model="multiSearchTerms" rows="5" required></textarea>
          <br /><br />

          <label for="filename">Choose Collection:</label>
          <select v-model="selectedFilename">
            <option value="">All Collections</option>
            <option v-for="file in uniqueFilenames" :key="file" :value="file">{{ file }}</option>
          </select>
          <br /><br />

          <button type="submit">Search</button>
          <button type="button" @click="showMultiSearchModal = false">Cancel</button>
        </form>
      </div>
    </div>

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
        file: null,
        username: '',
        password: '',
        showModal: false,
        showDeleteModal: false,
        selectedFilename: '',
        loading: false,
        multiSearchTerms: '',
        showMultiSearchModal: false,
      };
    },
    computed: {
      uniqueFilenames() {
        const filenames = this.names.map(row => row.filename.replace('.csv', ''));
        return [...new Set(filenames)];
      }
    },
    methods: {
      fetchNames() {
        fetch('/files')
          .then(response => response.json())
          .then(data => this.names = data)
          .catch(error => console.error('Error fetching data:', error));
      },
      searchItems() {
        if (!this.searchQuery) {
          this.fetchNames();
          return;
        }

        this.loading = true;
        fetch('/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: this.searchQuery, filename: this.selectedFilename }),
        })
          .then(response => response.json())
          .then(data => {
            this.names = data;
          })
          .catch(error => {
            console.error('Error searching:', error);
            alert(`Search failed: ${error.message}`);
          })
          .finally(() => {
            this.loading = false;
          });
      },
      performMultiSearch() {
        // Split by line and extract only the card names using regex
        const terms = this.multiSearchTerms
          .split('\n')
          .map(line => {
            // Remove unnecessary escape for '(' to satisfy ESLint
            const match = line.match(/^[\d]*\s*([^(]+)/);
            return match ? match[1].trim() : '';
          })
          .filter(Boolean); // Remove empty entries

        if (!terms.length) {
          alert('Please enter valid card names.');
          return;
        }

        this.loading = true;
        fetch('/multisearch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ terms, filename: this.selectedFilename }),
        })
          .then(response => response.json())
          .then(data => {
            this.names = data;
            this.showMultiSearchModal = false;
          })
          .catch(error => {
            console.error('Error in multisearch:', error);
            alert(`Multisearch failed: ${error.message}`);
          })
          .finally(() => {
            this.loading = false;
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

        this.loading = true;
        const formData = new FormData();
        formData.append('username', this.username);
        formData.append('password', this.password);
        formData.append('file', this.file);

        fetch('/upload', {
          method: 'POST',
          body: formData,
        })
          .then(response => response.json())
          .then(data => {
            alert(data.message);
            this.fetchNames();
            this.showModal = false;
          })
          .catch(error => {
            console.error('Error uploading file:', error);
            alert(`File upload failed: ${error.message}`);
          })
          .finally(() => {
            this.loading = false;
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
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: this.password }),
        })
          .then(response => response.json())
          .then(data => {
            alert(data.message);
            this.fetchNames();
            this.selectedFilename = '';
            this.showDeleteModal = false;
          })
          .catch(error => {
            console.error('Error deleting file:', error);
            alert('File deletion failed.');
          });
      }
    },
    mounted() {
      this.fetchNames();
    }
  };
</script>


<style scoped>
  .loading-indicator {
    text-align: center;
    font-size: 1.2em;
    color: #3498db;
  }

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

  th,
  td {
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

  .multisearch-button {
  margin-left: 10px;
  padding: 10px 20px;
  background-color: #2ecc71; /* Green color */
  color: white;
  border: none;
  cursor: pointer;
}

.multisearch-button:hover {
  background-color: #27ae60; /* Darker green on hover */
}
</style>