const express = require("express");
const urlRoutes = require("./routes/urlRoutes");

const app = express();

app.use(express.json());

app.use("/url", urlRoutes);

const PORT = 9000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});