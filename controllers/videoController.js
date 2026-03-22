const YTDlpWrap = require("yt-dlp-wrap").default;
const path = require("path");
const fs = require("fs");

// paths
const ytDlpBinary = path.join(process.cwd(), "yt-dlp");
const cookiesPath = path.join(process.cwd(), "cookies.txt");

let ytReady = false;

// initialize yt-dlp
const ytDlp = new YTDlpWrap(ytDlpBinary);

function ensureCookies() {
  if (!process.env.YOUTUBE_COOKIES) {
    console.log("⚠️ No cookies provided, continuing without cookies...");
    return false;
  }

  const content = process.env.YOUTUBE_COOKIES.replace(/\\n/g, "\n");

  fs.writeFileSync(cookiesPath, content, {
    encoding: "utf-8",
    flag: "w"
  });

  return true;
}

async function ensureYtDlp() {
  if (!ytReady) {
    if (!fs.existsSync(ytDlpBinary)) {
      console.log("⬇️ Downloading yt-dlp binary...");
      await YTDlpWrap.downloadFromGithub(ytDlpBinary);
    }

    // 🔥 VERY IMPORTANT (fixes most failures)
    fs.chmodSync(ytDlpBinary, 0o755);

    ytReady = true;
  }
}

/**
 * GET VIDEO INFO
 */
exports.getVideoInfo = async (req, res) => {
  try {
    await ensureYtDlp();

    const { url } = req.query;

    if (!url) {
      return res.status(400).json({ error: "url query param is required" });
    }

    const hasCookies = ensureCookies();

    const args = [
      url,
      "--dump-json",
      "--no-playlist"
    ];

    if (hasCookies) {
      args.push("--cookies", cookiesPath);
    }

    const data = await ytDlp.execPromise(args);
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
    console.error("INFO ERROR:", error?.stderr || error);

    res.status(500).json({
      error: "Could not fetch video info",
      details: error?.stderr || error.message
    });
  }
};

exports.downloadVideo = async (req, res) => {
  try {
    await ensureYtDlp();

    let { url, format } = req.query;

    if (!url) {
      return res.status(400).json({ error: "url query param is required" });
    }

    format = format || "best";

    const hasCookies = ensureCookies();

    // get metadata first
    const metaArgs = [
      url,
      "--dump-json",
      "--no-playlist"
    ];

    if (hasCookies) {
      metaArgs.push("--cookies", cookiesPath);
    }

    const data = await ytDlp.execPromise(metaArgs);
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

    const args = [
      url,
      "-f",
      format,
      "-o",
      "-",
      "--no-playlist"
    ];

    if (hasCookies) {
      args.push("--cookies", cookiesPath);
    }

    console.log("⬇️ Downloading with format:", format);

    const stream = ytDlp.execStream(args);

    stream
      .on("error", (err) => {
        console.error("STREAM ERROR:", err);

        if (!res.headersSent) {
          res.status(500).json({
            error: "Streaming failed",
            details: err.message
          });
        }
      })
      .pipe(res);

  } catch (error) {
    console.error("DOWNLOAD ERROR:", error?.stderr || error);

    res.status(500).json({
      error: "Download failed",
      details: error?.stderr || error.message
    });
  }
};