<template>
  <div>
    <input v-model="searchQuery" placeholder="Search for a name..." />
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
        <!-- Use filename + rowIndex as the unique key -->
        <tr v-for="row in filteredNames" :key="`${row.filename}-${row.rowIndex}`">
          <td>
            <!-- Make the Name clickable and link to CubeCobra with the Scryfall ID -->
            <a :href="`https://cubecobra.com/tool/card/${row['Scryfall ID']}`" target="_blank">
              {{ row['Name'] }}
            </a>
          </td>
          <td>{{ row['Set name'] }}</td>
          <td>{{ row['Foil'] }}</td>
          <td>{{ row['Rarity'] }}</td>
          <td>{{ row['Language'] }}</td>
          <!-- Remove .csv from the filename -->
          <td>{{ row.filename.replace('.csv', '') }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script>
export default {
  data() {
    return {
      searchQuery: '',
      names: [],  // This stores the full rows from the CSV
    };
  },
  computed: {
    filteredNames() {
      if (!this.searchQuery) return this.names;  // If no search query, return all names
      const query = this.searchQuery.toLowerCase();
      return this.names.filter(row => {
        // Ensure the row has a 'Name' field and it's properly formatted
        return row['Name'] && typeof row['Name'] === 'string' && row['Name'].toLowerCase().includes(query);
      });
    },
  },
  methods: {
    fetchNames() {
      fetch('http://localhost:3000/files')
        .then(response => response.json())
        .then(data => {
          this.names = data;  // Populate the 'names' array with the full rows from the CSV
        })
        .catch(error => {
          console.error('Error fetching data:', error);
        });
    },
  },
  mounted() {
    this.fetchNames();
  },
};
</script>

<style scoped>
/* Add some basic styling for table */
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
</style>
