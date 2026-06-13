const express = require("express");
const router = express.Router();
const verifyToken = require("../middleware/verifyToken")

const {
  shortenUrl,
  redirectUrl
} = require("../controllers/urlController");

router.post("/shorten", verifyToken, shortenUrl);
router.get("/:code", redirectUrl);

module.exports = router;