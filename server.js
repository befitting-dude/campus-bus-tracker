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
  lat: 23.826753729896605,
  lng: 78.77189619772187,
  lastUpdated: 0,
  speedKmh: 0,
  status: "stopped",
};

// Haversine formula: calculates real-world distance (in km) between two lat/lng points,
// accounting for the Earth's curvature. Straight-line "as the crow flies" distance,
// not actual road distance, but accurate enough for short bus-movement intervals.
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

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
    const now = Date.now();
    const previous = busLocation;

    const distanceKm = previous.lastUpdated 
      ? haversineDistance(previous.lat, previous.lng, data.lat, data.lng)
       : 0;

    const JITTER_THRESHOLD_KM = 0.015; // 15 meters, to ignore GPS jitter when calculating speed

    // Calculate speed using the Haversine formula (distance between two lat/lng points on Earth)
    let speedKmh = 0;
    if (previous.lastUpdated && distanceKm > JITTER_THRESHOLD_KM) {
      const distanceKm = haversineDistance(previous.lat, previous.lng, data.lat, data.lng);
      const timeHours = (now - previous.lastUpdated) / 1000 / 3600;
      speedKmh = timeHours > 0 ? distanceKm / timeHours : 0;
    }

    busLocation = {
      lat: data.lat,
      lng: data.lng,
      lastUpdated: now,
      speedKmh: Math.round(speedKmh * 10) / 10, // round to 1 decimal
      status: speedKmh < 2 ? "stopped" : "moving", // under 2 km/h counts as stopped (GPS jitter margin)
    };
    console.log("Real location received:", busLocation);
    io.emit("busLocation", busLocation);
  });

  socket.on("disconnect", () => {
    console.log("Someone disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Bus tracker running at http://localhost:${PORT}`);
});