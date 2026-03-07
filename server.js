const express = require("express");
const urlRoutes = require("./routes/urlRoutes");
const cors = require("cors");

const app = express();

app.use(cors());

app.use(express.json());

app.use("/url", urlRoutes);

const PORT = 9000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});