require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

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

const connectionEventSchema = new mongoose.Schema({
  role: String,
  event: String,
  timestamp: { type: Date, default: Date.now },
});
const ConnectionEvent = mongoose.model("ConnectionEvent", connectionEventSchema);

let busLocation = {
  lat: 23.826753729896605,
  lng: 78.77189619772187,
  lastUpdated: 0,
  speedKmh: 0,
  status: "stopped",
};

let conductorLocation = {
  lat: null,
  lng: null,
  lastUpdated: 0,
  speedKmh: 0,
  status: "offline",
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

const JITTER_THRESHOLD_KM = 0.015;

function computeMovement(previous, incoming) {
  const now = Date.now();
  const distanceKm = previous.lastUpdated
    ? haversineDistance(previous.lat, previous.lng, incoming.lat, incoming.lng)
    : 0;

  let speedKmh = 0;
  if (previous.lastUpdated && distanceKm > JITTER_THRESHOLD_KM) {
    const timeHours = (now - previous.lastUpdated) / 1000 / 3600;
    speedKmh = timeHours > 0 ? distanceKm / timeHours : 0;
  }

  return {
    lat: incoming.lat,
    lng: incoming.lng,
    lastUpdated: now,
    speedKmh: Math.round(speedKmh * 10) / 10,
    status: speedKmh < 2 ? "stopped" : "moving",
  };
}

let lastSavedAt = 0;
const SAVE_INTERVAL_MS = 30000;

io.on("connection", (socket) => {
  console.log("Someone connected:", socket.id);

  socket.emit("busLocation", busLocation);
  socket.emit("conductorLocationUpdate", conductorLocation);

  socket.on("driverLocation", (data) => {
    if (!socket.role) {
      socket.role = "driver";
      ConnectionEvent.create({ role: "driver", event: "connected" })
        .catch((err) => console.error("Failed to log connection event:", err.message));
    }

    busLocation = computeMovement(busLocation, data);
    io.emit("busLocation", busLocation);

    const now = Date.now();
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

  socket.on("conductorLocation", (data) => {
    if (!socket.role) {
      socket.role = "conductor";
      ConnectionEvent.create({ role: "conductor", event: "connected" })
        .catch((err) => console.error("Failed to log connection event:", err.message));
    }

    conductorLocation = computeMovement(conductorLocation, data);
    io.emit("conductorLocationUpdate", conductorLocation);
  });

  socket.on("disconnect", () => {
    console.log("Someone disconnected:", socket.id);
    if (socket.role) {
      ConnectionEvent.create({ role: socket.role, event: "disconnected" })
        .catch((err) => console.error("Failed to log connection event:", err.message));
    }
  });
});

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

app.get("/api/logs", async (req, res) => {
  try {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const logs = await RideLog.find({ timestamp: { $gte: startOfToday } })
      .sort({ timestamp: 1 })
      .select("speedKmh status timestamp -_id");
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: "Failed to load logs", details: err.message });
  }
});

app.get("/api/events", async (req, res) => {
  try {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const events = await ConnectionEvent.find({ timestamp: { $gte: startOfToday } })
      .sort({ timestamp: -1 })
      .limit(50)
      .select("role event timestamp -_id");
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: "Failed to load events", details: err.message });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Bus tracker running at http://localhost:${PORT}`);
});