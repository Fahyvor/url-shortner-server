const prisma = require("../models/prismaClient");

const BASE_URL = process.env.BASE_URL;

exports.shortenUrl = async (req, res) => {
  try {
    const { url, shortenedUrl } = req.body;

    if (!url || !shortenedUrl) {
      return res.status(400).json({ error: "URL and shortenedUrl are required" });
    }

    // check if shortcode already exists
    const exists = await prisma.url.findUnique({
      where: { shortCode: shortenedUrl }
    });

    if (exists) {
      return res.status(400).json({
        error: "Short code already exists, please choose another"
      });
    }

    const newUrl = await prisma.url.create({
      data: {
        originalUrl: url,
        shortCode: shortenedUrl
      }
    });

    const shortUrl = `${BASE_URL}/${newUrl.shortCode}`;

    return res.status(200).json({
        message: "URL shortened successfully",
      shortUrl,
      originalUrl: newUrl.originalUrl
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
};

exports.redirectUrl = async (req, res) => {
  try {
    const { code } = req.params;

    if (!code) {
      return res.status(400).json({ error: "Invalid code" });
    }

    const urlRecord = await prisma.url.findUnique({
      where: { shortCode: code }
    });

    if (!urlRecord) {
      return res.status(404).json({ error: "URL not found" });
    }

    return res.status(200).json({
      originalUrl: urlRecord.originalUrl
    });

  } catch (error) {
    console.error("Redirect Error:", error);
    return res.status(500).json({ error: "Server error" });
  }
};