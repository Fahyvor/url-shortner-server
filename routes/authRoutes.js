const express = require("express");
const router = express.Router();
const {
  googleRedirect,
  googleCallback,
  getAllUsers
} = require("../controllers/authController");
const verifyToken = require("../middleware/verifyToken")

router.get("/google", googleRedirect);
router.get("/google/callback", googleCallback);
router.get("/users/all-users", verifyToken, getAllUsers)

module.exports = router;