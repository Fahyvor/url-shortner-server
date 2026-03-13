const express = require("express");
const urlRoutes = require("./routes/urlRoutes");
const videoRoutes = require("./routes/videoRoutes");
const cors = require("cors");

const app = express();

app.use(cors());

app.use(express.json());

app.use("/url", urlRoutes);
app.use("/video", videoRoutes);

const PORT = 9000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});