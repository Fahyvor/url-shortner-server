const express = require('express');
const { getVideoInfo, downloadVideo } = require('../controllers/videoController');

const router = express.Router();

router.get('/info', getVideoInfo);
router.get('/download', downloadVideo);

module.exports = router;