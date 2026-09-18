require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

// --- MongoDB connection ---
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("MongoDB connection error:", err.message));

const rideLogSchema = new mongoose.Schema({
  lat: Number,
  lng: Number,
  speedKmh: Number,
  status: String,
  timestamp: { type: Date, default: Date.now },
});
const RideLog = mongoose.model("RideLog", rideLogSchema);

// --- Current bus position, held in memory ---
let busLocation = {
  lat: 23.826753729896605,
  lng: 78.77189619772187,
  lastUpdated: 0,
  speedKmh: 0,
  status: "stopped",
};

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
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

let lastSavedAt = 0;
const SAVE_INTERVAL_MS = 30000;

// --- Socket.IO connection handling ---
io.on("connection", (socket) => {
  console.log("Someone connected:", socket.id);

  socket.emit("busLocation", busLocation);

  socket.on("driverLocation", (data) => {
    const now = Date.now();
    const previous = busLocation;

    const distanceKm = previous.lastUpdated
      ? haversineDistance(previous.lat, previous.lng, data.lat, data.lng)
      : 0;

    const JITTER_THRESHOLD_KM = 0.015;

    let speedKmh = 0;
    if (previous.lastUpdated && distanceKm > JITTER_THRESHOLD_KM) {
      const timeHours = (now - previous.lastUpdated) / 1000 / 3600;
      speedKmh = timeHours > 0 ? distanceKm / timeHours : 0;
    }

    busLocation = {
      lat: data.lat,
      lng: data.lng,
      lastUpdated: now,
      speedKmh: Math.round(speedKmh * 10) / 10,
      status: speedKmh < 2 ? "stopped" : "moving",
    };

    io.emit("busLocation", busLocation);

    if (now - lastSavedAt > SAVE_INTERVAL_MS) {
      lastSavedAt = now;
      RideLog.create({
        lat: busLocation.lat,
        lng: busLocation.lng,
        speedKmh: busLocation.speedKmh,
        status: busLocation.status,
      }).catch((err) => console.error("Failed to save ride log:", err.message));
    }
  });

  socket.on("disconnect", () => {
    console.log("Someone disconnected:", socket.id);
  });
});

// --- Stats route — registered ONCE, at startup, not inside any connection handler ---
app.get("/api/stats", async (req, res) => {
  try {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const logs = await RideLog.find({ timestamp: { $gte: startOfToday } }).sort({ timestamp: 1 });

    let totalDistanceKm = 0;
    let movingCount = 0;
    for (let i = 1; i < logs.length; i++) {
      totalDistanceKm += haversineDistance(logs[i - 1].lat, logs[i - 1].lng, logs[i].lat, logs[i].lng);
      if (logs[i].status === "moving") movingCount++;
    }

    res.json({
      totalLogs: logs.length,
      totalDistanceKm: Math.round(totalDistanceKm * 10) / 10,
      firstSeen: logs[0]?.timestamp || null,
      lastSeen: logs[logs.length - 1]?.timestamp || null,
      movingPercentage: logs.length ? Math.round((movingCount / logs.length) * 100) : 0,
    });
  } catch (err) {
    console.error("Stats endpoint error:", err.message);
    res.status(500).json({ error: "Failed to load stats", details: err.message });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Bus tracker running at http://localhost:${PORT}`);
});