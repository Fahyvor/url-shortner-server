const YTDlpWrap = require("yt-dlp-wrap").default;
const path = require("path");
const fs = require("fs");

// paths
const ytDlpBinary = path.join(process.cwd(), "yt-dlp");
const cookiesPath = path.join(process.cwd(), "cookies.txt");

// initialize yt-dlp
const ytDlp = new YTDlpWrap(ytDlpBinary);

let ytReady = false;

// ensure yt-dlp binary exists
async function ensureYtDlp() {
  if (!ytReady) {
    if (!fs.existsSync(ytDlpBinary)) {
      console.log("Downloading yt-dlp binary...");
      await YTDlpWrap.downloadFromGithub(ytDlpBinary);
    }
    ytReady = true;
  }
}

exports.getVideoInfo = async (req, res) => {
  try {
    await ensureYtDlp();

    const { url } = req.query;

    if (!url) {
      return res.status(400).json({ error: "url query param is required" });
    }

    const data = await ytDlp.execPromise([
      url,
      "--cookies",
      cookiesPath,
      "--dump-json",
      "--no-playlist",
      "--extractor-args",
      "youtube:player_client=android"
    ]);

    const metadata = JSON.parse(data);

    return res.status(200).json({
      title: metadata.title,
      thumbnail: metadata.thumbnail,
      duration: metadata.duration,
      uploader: metadata.uploader,
      platform: metadata.extractor_key,
      formats: metadata.formats?.map((f) => ({
        formatId: f.format_id,
        ext: f.ext,
        resolution: f.resolution || "audio only",
        filesize: f.filesize,
        note: f.format_note
      }))
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Could not fetch video info. Check the URL or platform support."
    });
  }
};

exports.downloadVideo = async (req, res) => {
  try {
    await ensureYtDlp();

    const { url, format = "best" } = req.query;

    if (!url) {
      return res.status(400).json({ error: "url query param is required" });
    }

    // fetch metadata first
    const data = await ytDlp.execPromise([
      url,
      "--cookies",
      cookiesPath,
      "--dump-json",
      "--no-playlist",
      "--extractor-args",
      "youtube:player_client=android"
    ]);

    const metadata = JSON.parse(data);

    const safeTitle = metadata.title
      .replace(/[^a-zA-Z0-9_\-]/g, "_")
      .slice(0, 80);

    const ext = format === "bestaudio" ? "mp3" : "mp4";
    const filename = `${safeTitle}.${ext}`;

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`
    );

    res.setHeader(
      "Content-Type",
      format === "bestaudio" ? "audio/mpeg" : "video/mp4"
    );

    ytDlp.execStream([
      url,
      "--cookies",
      cookiesPath,
      "--no-playlist",
      "--extractor-args",
      "youtube:player_client=android",
      "-f",
      format,
      "-o",
      "-"
    ])
    .pipe(res)
    .on("error", (err) => {
      console.error("Stream error:", err);

      if (!res.headersSent) {
        res.status(500).json({ error: "Streaming failed" });
      }
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Download failed. Check the URL or format."
    });
  }
};