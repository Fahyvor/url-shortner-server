const express = require("express");
const urlRoutes = require("./routes/urlRoutes");
const videoRoutes = require("./routes/videoRoutes");
const authRoutes = require("./routes/authRoutes")
const cors = require("cors");

const app = express();

app.use(cors());

app.use(express.json());

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use("/url", urlRoutes);
app.use("/video", videoRoutes);
app.use("/auth", authRoutes)

const PORT = 9000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});