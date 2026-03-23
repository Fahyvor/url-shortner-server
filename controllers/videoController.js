const YTDlpWrap = require("yt-dlp-wrap").default;
const path = require("path");
const fs = require("fs");
const os = require("os");

// paths
const ytDlpBinary = path.join(process.cwd(), "yt-dlp");const cookiesPath = path.join(process.cwd(), "cookies.txt");

function ensureCookies() {
  if (!process.env.YOUTUBE_COOKIES) {
    throw new Error("Missing YOUTUBE_COOKIES in .env");
  }

  const content = process.env.YOUTUBE_COOKIES.replace(/\\n/g, "\n");

  fs.writeFileSync(cookiesPath, content, {
    encoding: "utf-8",
    flag: "w"
  });

}

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
    ensureCookies();

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

    const args = [
      url,
      "--dump-json",
      "--no-playlist"
    ];

    if (process.env.YOUTUBE_COOKIES) {
      args.push("--cookies", cookiesPath);
    }

    const data = await ytDlp.execPromise(args);
    const metadata = JSON.parse(data);

    // 🔥 IMPORTANT: deduplicate + clean formats
    const formats = metadata.formats
      ?.filter(f => f.vcodec !== "none") // only video formats
      ?.map((f) => ({
        formatId: f.format_id,
        ext: f.ext,
        resolution: f.height ? `${f.height}p` : null,
        height: f.height,
        fps: f.fps,
        filesize: f.filesize,
        hasAudio: f.acodec !== "none",
        note: f.format_note
      }))
      // 🔥 remove duplicates (same resolution)
      ?.reduce((acc, curr) => {
        const exists = acc.find(f => f.height === curr.height);
        if (!exists) acc.push(curr);
        return acc;
      }, [])
      // 🔥 sort quality properly
      ?.sort((a, b) => (b.height || 0) - (a.height || 0));

    return res.status(200).json({
      title: metadata.title,
      thumbnail: metadata.thumbnail,
      duration: metadata.duration,
      uploader: metadata.uploader,
      platform: metadata.extractor_key,
      formats
    });

  } catch (error) {
    console.error("❌ INFO ERROR:", error?.stderr || error);

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

    // return console.log("Format", format);

    // detect format type
    const isNumericFormat = /^\d+$/.test(format);

    let ytFormat;

    if (format === "best") {
      ytFormat = "best";
    } else if (format === "bestaudio") {
      ytFormat = "bestaudio";
    } else if (isNumericFormat) {
      ytFormat = `${format}+bestaudio/best`;
    } else {
      ytFormat = "best";
    }

    const ext = format === "bestaudio" ? "mp3" : "mp4";
    const outputPath = path.join(os.tmpdir(), `video_${Date.now()}.${ext}`);

    // fetch metadata
    const metaArgs = [url, "--dump-json", "--no-playlist"];
    if (process.env.YOUTUBE_COOKIES) {
      metaArgs.push("--cookies", cookiesPath);
    }

    const data = await ytDlp.execPromise(metaArgs);
    const metadata = JSON.parse(data);

    const safeTitle = metadata.title
      .replace(/[^a-zA-Z0-9_\-]/g, "_")
      .slice(0, 80);

    const filename = `${safeTitle}.${ext}`;

    // yt-dlp args to download
    const args = [url, "-f", ytFormat, "-o", outputPath, "--no-playlist"];
    if (process.env.YOUTUBE_COOKIES) {
      args.push("--cookies", cookiesPath);
    }

    if (format === "bestaudio") {
      args.push("--extract-audio", "--audio-format", "mp3");
    }

    console.log("Downloading with format:", ytFormat);

    await ytDlp.execPromise(args);

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`
    );
    res.setHeader(
      "Content-Type",
      format === "bestaudio" ? "audio/mpeg" : "video/mp4"
    );

    res.download(outputPath, filename, (err) => {
      if (err) {
        console.error("Error sending file:", err);
      }
      fs.unlink(outputPath, () => {});
    });

  } catch (error) {
    console.error("Download error:", error?.stderr || error);
    res.status(500).json({
      error: "Download failed",
      details: error?.stderr || error.message
    });
  }
};