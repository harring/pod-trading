module.exports = {
  // Disable source maps in production to reduce file size
  productionSourceMap: false,

  // Customize output directory of the build
  outputDir: '../server/public', // Place frontend build files in server/public

  // Set the publicPath so the application works correctly when served from a subdirectory
  publicPath: './', // Ensures relative paths in the final build (useful for containers or subpaths)
};
