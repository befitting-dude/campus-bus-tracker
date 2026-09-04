// server.js — the "brain" of the bus tracker.
// Job: (1) serve the webpage, (2) keep the current bus position in memory,
// (3) push updates to every connected browser the instant the position changes.

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);      // Socket.IO needs the raw http server, not just Express
const io = new Server(server);               // wraps the server with real-time capability

// --- Step 1: serve the frontend files ---
// Anything inside /public (our HTML, CSS, JS) becomes directly accessible in the browser.
app.use(express.static("public"));

// --- Step 2: hold the CURRENT bus position in memory ---
// No database needed for v1 — we only care about "where is it RIGHT NOW", not history.
let busLocation = {
  lat: 23.8300,   // placeholder coordinates — replace with your actual campus later
  lng: 78.7378,
  lastUpdated: Date.now(),
};

// --- Step 3: when a browser connects, immediately send it the current position ---
// Without this, a student who opens the app AFTER the last update would see nothing
// until the next broadcast — could be seconds of a blank map.
io.on("connection", (socket) => {
  console.log("Someone connected:", socket.id);

  // Whoever just connected (student OR driver) immediately gets the latest known position.
  socket.emit("busLocation", busLocation);

  // --- REAL GPS from the driver's phone ---
  // The driver page (driver.html) sends its actual coordinates here, repeatedly.
  // Whatever arrives becomes the new official bus location, broadcast to everyone.
  socket.on("driverLocation", (data) => {
    busLocation = {
      lat: data.lat,
      lng: data.lng,
      lastUpdated: Date.now(),
    };
    console.log("Real location received:", busLocation);
    io.emit("busLocation", busLocation); // relay to every student's map
  });

  socket.on("disconnect", () => {
    console.log("Someone disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Bus tracker running at http://localhost:${PORT}`);
});
