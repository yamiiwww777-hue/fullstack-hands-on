// Tiny static file server for the game, plus a /config.js endpoint that
// tells the browser where the backend API lives. This is how the frontend
// container is "linked" to the backend container: docker-compose passes
// API_BASE_URL as an env var, and we hand it to client-side JS at runtime
// so nothing needs to be hardcoded or rebuilt.
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:8000";

app.get("/config.js", (req, res) => {
  res.type("application/javascript");
  res.send(`window.API_BASE_URL = ${JSON.stringify(API_BASE_URL)};`);
});

app.use(express.static(path.join(__dirname, "src")));

app.listen(PORT, () => {
  console.log(`Flappy Bird frontend listening on port ${PORT}`);
  console.log(`Backend API URL: ${API_BASE_URL}`);
});
