const YTDlpWrap = require("yt-dlp-wrap").default;

const ytDlp = new YTDlpWrap();
exports.getVideoInfo = async (req, res) => {
  try {
    const { url } = req.query;

    if (!url) {
      return res.status(400).json({ error: "url query param is required" });
    }

    const metadata = await ytDlp.getVideoInfo(url);

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
        note: f.format_note,
      })),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not fetch video info. Check the URL or platform support." });
  }
};

exports.downloadVideo = async (req, res) => {
  try {
    const { url, format = "best" } = req.query;

    if (!url) {
      return res.status(400).json({ error: "url query param is required" });
    }

    const metadata = await ytDlp.getVideoInfo(url);
    const safeTitle = metadata.title.replace(/[^a-zA-Z0-9_\-]/g, "_").slice(0, 80);
    const ext = format === "bestaudio" ? "mp3" : "mp4";
    const filename = `${safeTitle}.${ext}`;

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", format === "bestaudio" ? "audio/mpeg" : "video/mp4");

    ytDlp
      .execStream([
        url,
        "-f", format,
        "--no-playlist",    
        "-o", "-",         
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
    res.status(500).json({ error: "Download failed. Check the URL or format." });
  }
};