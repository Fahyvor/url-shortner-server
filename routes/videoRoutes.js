const express = require('express');
const { getVideoInfo, downloadVideo } = require('../controllers/videoController');
const verifyToken = require("../middleware/verifyToken")

const router = express.Router();

router.get('/info', verifyToken, getVideoInfo);
router.get('/download', downloadVideo);

module.exports = router;