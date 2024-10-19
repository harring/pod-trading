module.exports = {
  devServer: {
    proxy: {
      '/files': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true, // Enable WebSocket proxying
      },
    },
  },
};
