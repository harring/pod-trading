<template>
  <div>
    <!-- Search Input -->
    <input v-model="searchQuery" placeholder="Search for a name..." />

    <!-- Upload button in top-right -->
    <button @click="showModal = true" class="upload-button">Upload CSV</button>

    <!-- Table of Data -->
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Set Name</th>
          <th>Foil</th>
          <th>Rarity</th>
          <th>Language</th>
          <th>Filename</th>
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

          <button type="submit">Upload</button>
          <button type="button" @click="showModal = false">Cancel</button>
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
      showModal: false, // Controls the modal visibility
    };
  },
  computed: {
    filteredNames() {
      if (!this.searchQuery) return this.names;
      const query = this.searchQuery.toLowerCase();
      return this.names.filter(row => {
        return row['Name'] && typeof row['Name'] === 'string' && row['Name'].toLowerCase().includes(query);
      });
    },
  },
  methods: {
    fetchNames() {
      fetch('http://localhost:3000/files')
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
      if (!this.file || !this.username) {
        alert('Please fill in all fields.');
        return;
      }

      const formData = new FormData();
      formData.append('file', this.file);
      formData.append('username', this.username);

      fetch('http://localhost:3000/upload', {
        method: 'POST',
        body: formData,
      })
        .then(() => {
          alert('File uploaded successfully!');
          this.fetchNames(); // Refresh the table after upload
          this.showModal = false; // Close the modal after upload
        })
        .catch(error => {
          console.error('Error uploading file:', error);
          alert('File upload failed.');
        });
    },
  },
  mounted() {
    this.fetchNames();
  },
};
</script>

<style scoped>
/* Add some basic styling */
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
  position: absolute;
  top: 10px;
  right: 10px;
  padding: 10px 20px;
  background-color: #3498db;
  color: white;
  border: none;
  cursor: pointer;
}

.upload-button:hover {
  background-color: #2980b9;
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
