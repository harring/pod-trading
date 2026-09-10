<template>
  <div>
    <div class="header">
      <img src="@/assets/logo.png" alt="Pod-Trading Logo" class="logo" />
      <h1 class="site-name">Pod-Trading</h1>
    </div>

    <div style="display: flex; align-items: center;">
      <input v-model="searchQuery" placeholder="Search for a name..." @keyup.enter="searchItems" />
      <select v-model="selectedFilename" @change="loadResults">
        <option value="">All Collections</option>
        <option v-for="file in collections" :key="file" :value="file">{{ file }}</option>
      </select>
      <button @click="showMultiSearchModal = true" class="multisearch-button">Multisearch</button>
      <button @click="showModal = true" class="upload-button">Upload Collection</button>
      <button @click="showDeleteModal = true" class="delete-button" :disabled="!selectedFilename">Delete
        Selected</button>
    </div>

    <p v-if="notice" role="status">{{ notice }}</p>
    <p v-if="collectionsError" role="alert">{{ collectionsError }}
      <button @click="refreshCollections">Retry</button>
    </p>
    <p v-if="resultsError" role="alert">{{ resultsError }}
      <button @click="loadResults">Retry</button>
    </p>

    <!-- Loading Indicator -->
    <div v-if="loading" class="loading-indicator">
      <p>Loading, please wait...</p>
    </div>

    <table v-else-if="!resultsError">
      <thead>
        <tr>
          <th>Name</th>
          <th>Set Name</th>
          <th>Rarity</th>
          <th>Language</th>
          <th>Collection</th>
          <th>Market price (EUR)</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="!names.length"><td colspan="6">No cards found.</td></tr>
        <tr v-for="(row, index) in names" :key="`${row.filename}-${index}`">
          <td><a :href="`https://scryfall.com/cards/${row['Scryfall ID']}`" target="_blank">{{ row['Name'] }}</a></td>
          <td>{{ row['Set name'] }}</td>
          <td>{{ row['Rarity'] }}{{ finishLabel(row['Foil']) }}</td>
          <td>{{ row['Language'] }}</td>
          <td>{{ row.filename.replace('.csv', '') }}</td>
          <td>{{ row['Market price EUR'] && row['Market price EUR'] !== 'N/A' ? row['Market price EUR'] + ' €' : 'N/A' }}</td>
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
          <select v-model="selectedFilename" @change="loadResults">
            <option value="">All Collections</option>
            <option v-for="file in collections" :key="file" :value="file">{{ file }}</option>
          </select>
          <br /><br />

          <p v-if="resultsError" role="alert">{{ resultsError }}</p>
          <button type="submit" :disabled="loading">Search</button>
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
          <input type="text" v-model="username" maxlength="80" required />
          <p>Use letters, numbers, spaces, underscores or hyphens. CSV limit: 10 MiB.</p>
          <br /><br />

          <label for="file">Choose CSV file:</label>
          <input type="file" @change="onFileChange" accept=".csv" required />
          <br /><br />

          <label for="password">Enter password:</label>
          <input type="password" v-model="password" required />
          <br /><br />

          <p v-if="uploadError" role="alert">{{ uploadError }}</p>
          <button type="submit" :disabled="uploading">{{ uploading ? 'Uploading…' : 'Upload' }}</button>
          <button type="button" :disabled="uploading" @click="showModal = false">Cancel</button>
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

          <p v-if="deleteError" role="alert">{{ deleteError }}</p>
          <button type="submit" :disabled="deleting">{{ deleting ? 'Deleting…' : 'Delete' }}</button>
          <button type="button" :disabled="deleting" @click="showDeleteModal = false">Cancel</button>
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
        collections: [],
        activeSearch: null,
        resultsRequest: 0,
        file: null,
        username: '',
        password: '',
        showModal: false,
        showDeleteModal: false,
        selectedFilename: '',
        loading: false,
        uploading: false,
        deleting: false,
        resultsError: '',
        collectionsError: '',
        uploadError: '',
        deleteError: '',
        notice: '',
        multiSearchTerms: '',
        showMultiSearchModal: false,
      };
    },
    methods: {
      finishLabel(value) {
        const finish = String(value || '').toLowerCase().replace(/[\s_-]+/g, '');
        if (finish === 'surgefoil') return ' surge foil';
        return finish === 'foil' ? ' foil' : '';
      },
      async requestJSON(url, options) {
        let response;
        try {
          response = await fetch(url, options);
        } catch {
          throw new Error('Unable to reach the server. Check your connection and try again.');
        }
        let data;
        try {
          data = await response.json();
        } catch {
          throw new Error(response.ok ? 'The server returned an invalid response. Please try again.' :
            `Request failed (HTTP ${response.status}). Please try again.`);
        }
        if (!response.ok) throw new Error(typeof data?.message === 'string' ? data.message :
          `Request failed (HTTP ${response.status}). Please try again.`);
        return data;
      },
      async refreshCollections() {
        this.collectionsError = '';
        try {
          const collections = await this.requestJSON('/collections');
          if (!Array.isArray(collections) || !collections.every(name => typeof name === 'string')) {
            throw new Error('The server returned an invalid collection list.');
          }
          this.collections = collections;
          if (this.selectedFilename && !this.collections.includes(this.selectedFilename)) {
            this.selectedFilename = '';
          }
          await this.loadResults();
        } catch (error) {
          this.collectionsError = `Unable to load collections: ${error.message}`;
        }
      },
      async loadResults() {
        const request = ++this.resultsRequest;
        this.loading = true;
        this.resultsError = '';
        this.names = [];
        try {
          const search = this.activeSearch;
          const data = search
            ? await this.requestJSON(search.terms ? '/multisearch' : '/search', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...search, filename: this.selectedFilename }),
            })
            : await this.requestJSON(`/files${this.selectedFilename ? `?filename=${encodeURIComponent(this.selectedFilename)}` : ''}`);
          if (!Array.isArray(data) || !data.every(row => row && typeof row.filename === 'string')) {
            throw new Error('The server returned invalid card results.');
          }
          // A slow response from an earlier selection must not replace the current view.
          if (request !== this.resultsRequest) return false;
          this.names = data;
          return true;
        } catch (error) {
          if (request === this.resultsRequest) this.resultsError = `Unable to load cards: ${error.message}`;
          return false;
        } finally {
          if (request === this.resultsRequest) this.loading = false;
        }
      },
      searchItems() {
        const query = this.searchQuery.trim();
        this.activeSearch = query ? { query } : null;
        return this.loadResults();
      },
      async performMultiSearch() {
        const terms = this.multiSearchTerms.split('\n').map(line => {
          const match = line.match(/^[\d]*\s*([^(]+)/);
          return match ? match[1].trim() : '';
        }).filter(Boolean);
        if (!terms.length) {
          this.resultsError = 'Please enter valid card names.';
          return;
        }
        this.activeSearch = { terms };
        if (await this.loadResults()) this.showMultiSearchModal = false;
      },
      onFileChange(event) {
        this.file = event.target.files[0];
      },
      async uploadFile() {
        if (this.uploading) return;
        this.uploadError = '';
        this.notice = '';
        if (!this.file || !this.username || !this.password) {
          this.uploadError = 'Please fill in all fields.';
          return;
        }
        this.uploading = true;
        try {
          const formData = new FormData();
          formData.append('username', this.username);
          formData.append('file', this.file);
          await this.requestJSON('/upload', {
            method: 'POST', headers: { password: this.password }, body: formData,
          });
          this.notice = 'Collection uploaded successfully.';
          this.showModal = false;
          await this.refreshCollections();
        } catch (error) {
          this.uploadError = `Upload failed: ${error.message}`;
        } finally {
          this.uploading = false;
        }
      },
      async deleteCSV() {
        if (this.deleting) return;
        this.deleteError = '';
        this.notice = '';
        if (!this.password || !this.selectedFilename) {
          this.deleteError = 'Select a collection and enter the password.';
          return;
        }
        this.deleting = true;
        const name = this.selectedFilename;
        try {
          await this.requestJSON(`/delete/${encodeURIComponent(`${name}.csv`)}`, {
            method: 'DELETE', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: this.password }),
          });
          this.notice = 'Collection deleted successfully.';
          this.showDeleteModal = false;
          this.collections = this.collections.filter(collection => collection !== name);
          if (this.selectedFilename === name) this.selectedFilename = '';
          // Invalidate outstanding searches so deleted cards cannot reappear.
          ++this.resultsRequest;
          this.names = [];
          this.loading = false;
          await this.refreshCollections();
        } catch (error) {
          this.deleteError = `Deletion failed: ${error.message}`;
        } finally {
          this.deleting = false;
        }
      }
    },
    mounted() {
      this.refreshCollections();
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
