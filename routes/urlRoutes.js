const express = require("express");
const router = express.Router();

const {
  shortenUrl,
  redirectUrl
} = require("../controllers/urlController");

router.post("/shorten", shortenUrl);
router.get("/:code", redirectUrl);

module.exports = router;