const path = require("path");
module.exports = {
  entry: "./src/index.js",
  devServer: {
    static: {
      directory: __dirname,
    },
  },
  output: {
    path: __dirname,
    filename: "index.js",
  },
  mode: "development",
};
