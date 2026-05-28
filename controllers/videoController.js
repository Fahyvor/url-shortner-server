
const YTDlpWrap = require("yt-dlp-wrap").default;
const path = require("path");
const fs = require("fs");
const os = require("os");

// paths
const ytDlpBinary = path.join(process.cwd(), "yt-dlp");
const cookiesPath = path.join(process.cwd(), "cookies.txt");

const ytDlp = new YTDlpWrap(ytDlpBinary);

let ytReady = false;

// ----------------------
// INIT
// ----------------------
function ensureCookies() {
  if (!process.env.YOUTUBE_COOKIES) return;

  const content = process.env.YOUTUBE_COOKIES.replace(/\\n/g, "\n");

  fs.writeFileSync(cookiesPath, content, {
    encoding: "utf-8",
    flag: "w",
  });
}

async function ensureYtDlp() {
  if (!ytReady) {
    if (!fs.existsSync(ytDlpBinary)) {
      await YTDlpWrap.downloadFromGithub(ytDlpBinary);
    }

    try {
      await ytDlp.execPromise(["-U"]);
    } catch {}

    ensureCookies();
    ytReady = true;
  }
}

// ----------------------
// PLATFORM DETECTION
// ----------------------
function detectPlatform(url) {
  if (!url) return "unknown";

  if (url.includes("youtube.com") || url.includes("youtu.be")) return "youtube";
  if (url.includes("x.com") || url.includes("twitter.com")) return "twitter";
  if (url.includes("tiktok.com")) return "tiktok";
  if (url.includes("instagram.com")) return "instagram";

  return "unknown";
}

// ----------------------
// COMMON FLAGS
// ----------------------
function baseArgs() {
  return [
    "--no-playlist",
    "--user-agent",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    "--add-header",
    "Accept-Language: en-US,en;q=0.9",
    "--socket-timeout",
    "30",
    "--merge-output-format",
    "mp4",
    "--max-filesize",
    "50M",
  ];
}

// ----------------------
// SMART EXEC
// ----------------------
async function smartExec(url, args, platform) {
  try {
    return await ytDlp.execPromise([...args]);
  } catch (err) {
    console.warn("Primary attempt failed");

    // 🔥 YouTube fallback with cookies
    if (
      platform === "youtube" &&
      process.env.YOUTUBE_COOKIES &&
      fs.existsSync(cookiesPath)
    ) {
      console.log("Retrying with cookies...");

      return await ytDlp.execPromise([
        ...args,
        "--cookies",
        cookiesPath,
      ]);
    }

    // 🔥 fallback lightweight format
    console.log("Retrying with lighter format...");

    return await ytDlp.execPromise([
      url,
      "-f",
      "worst",
      ...baseArgs(),
    ]);
  }
}

// ----------------------
// GET INFO
// ----------------------
exports.getVideoInfo = async (req, res) => {
  try {
    await ensureYtDlp();

    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ error: "url is required" });
    }

    const platform = detectPlatform(url);

    const args = [
      url,
      "--dump-json",
      ...baseArgs(),
    ];

    const data = await smartExec(url, args, platform);
    const metadata = JSON.parse(data);

    const formats = metadata.formats
      ?.filter(f => f.vcodec !== "none")
      ?.map(f => ({
        formatId: f.format_id,
        ext: f.ext,
        resolution: f.height ? `${f.height}p` : null,
        height: f.height,
        filesize: f.filesize,
      }))
      ?.sort((a, b) => (b.height || 0) - (a.height || 0));

    res.json({
      title: metadata.title,
      thumbnail: metadata.thumbnail,
      duration: metadata.duration,
      uploader: metadata.uploader,
      platform,
      formats,
    });

  } catch (error) {
    console.error("INFO ERROR:", error?.stderr || error);

    res.status(500).json({
      error: "Failed to fetch info",
      details: error?.stderr || error.message,
    });
  }
};

// ----------------------
// DOWNLOAD
// ----------------------
exports.downloadVideo = async (req, res) => {
  try {
    await ensureYtDlp();

    let { url, format } = req.query;
    if (!url) {
      return res.status(400).json({ error: "url is required" });
    }

    const platform = detectPlatform(url);

    format = format || "best";

    let ytFormat =
      format === "bestaudio"
        ? "bestaudio"
        : /^\d+$/.test(format)
        ? `${format}+bestaudio/best`
        : "bestvideo+bestaudio/best";

    const ext = format === "bestaudio" ? "mp3" : "mp4";

    const outputPath = path.join(
      os.tmpdir(),
      `video_${Date.now()}.${ext}`
    );

    // ---- metadata ----
    const metaRaw = await smartExec(
      url,
      [url, "--dump-json", ...baseArgs()],
      platform
    );

    const metadata = JSON.parse(metaRaw);

    const safeTitle = (metadata.title || "video")
      .replace(/[^a-zA-Z0-9_\-]/g, "_")
      .slice(0, 80);

    const filename = `${safeTitle}.${ext}`;

    // ---- download ----
    const args = [
      url,
      "-f",
      ytFormat,
      "-o",
      outputPath,
      ...baseArgs(),
    ];

    if (format === "bestaudio") {
      args.push("--extract-audio", "--audio-format", "mp3");
    }

    console.log(`Downloading (${platform}):`, ytFormat);

    await smartExec(url, args, platform);

    if (!fs.existsSync(outputPath)) {
      throw new Error("File not created");
    }

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`
    );

    res.setHeader(
      "Content-Type",
      format === "bestaudio" ? "audio/mpeg" : "video/mp4"
    );

    res.download(outputPath, filename, () => {
      fs.unlink(outputPath, () => {});
    });

  } catch (error) {
    console.error("DOWNLOAD ERROR:", error?.stderr || error);

    res.status(500).json({
      error: "Download failed",
      details: error?.stderr || error.message,
    });
  }
};

// const YTDlpWrap = require("yt-dlp-wrap").default;
// const path = require("path");
// const fs = require("fs");
// const os = require("os");

// // paths
// const ytDlpBinary = path.join(process.cwd(), "yt-dlp");
// const ytDlp = new YTDlpWrap(ytDlpBinary);

// let ytReady = false;

// // ----------------------
// // Ensure yt-dlp
// // ----------------------
// async function ensureYtDlp() {
//   if (!ytReady) {
//     if (!fs.existsSync(ytDlpBinary)) {
//       console.log("Downloading yt-dlp...");
//       await YTDlpWrap.downloadFromGithub(ytDlpBinary);
//     }

//     try {
//       console.log("Updating yt-dlp...");
//       await ytDlp.execPromise(["-U"]);
//     } catch (e) {
//       console.log("Update failed, continuing...");
//     }

//     ytReady = true;
//   }
// }

// // ----------------------
// // COMMON FLAGS (SAFE FOR PRODUCTION)
// // ----------------------
// function getCommonArgs() {
//   return [
//     "--no-playlist",
//     "--user-agent",
//     "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
//     "--add-header",
//     "Accept-Language: en-US,en;q=0.9",
//     "--sleep-interval",
//     "2",
//     "--max-sleep-interval",
//     "5",
//   ];
// }

// // ----------------------
// // SAFE EXEC WITH RETRY (NO COOKIES LOGIC)
// // ----------------------
// async function safeExec(args) {
//   try {
//     return await ytDlp.execPromise(args);
//   } catch (err) {
//     console.warn("yt-dlp failed, retrying without extra flags...");

//     const cleanedArgs = args.filter(
//       (arg) =>
//         arg !== "--cookies" &&
//         arg !== "--cookies-from-browser"
//     );

//     return await ytDlp.execPromise(cleanedArgs);
//   }
// }

// // ----------------------
// // GET VIDEO INFO
// // ----------------------
// exports.getVideoInfo = async (req, res) => {
//   try {
//     await ensureYtDlp();

//     const { url } = req.query;

//     if (!url) {
//       return res.status(400).json({ error: "url query param is required" });
//     }

//     const args = [
//       url,
//       "--dump-json",
//       ...getCommonArgs(),
//     ];

//     const data = await safeExec(args);
//     const metadata = JSON.parse(data);

//     const formats = metadata.formats
//       ?.filter((f) => f.vcodec !== "none")
//       ?.map((f) => ({
//         formatId: f.format_id,
//         ext: f.ext,
//         resolution: f.height ? `${f.height}p` : null,
//         height: f.height,
//         fps: f.fps,
//         filesize: f.filesize,
//         hasAudio: f.acodec !== "none",
//       }))
//       ?.reduce((acc, curr) => {
//         if (!acc.find((f) => f.height === curr.height)) acc.push(curr);
//         return acc;
//       }, [])
//       ?.sort((a, b) => (b.height || 0) - (a.height || 0));

//     res.json({
//       title: metadata.title,
//       thumbnail: metadata.thumbnail,
//       duration: metadata.duration,
//       uploader: metadata.uploader,
//       formats,
//     });

//   } catch (error) {
//     console.error("INFO ERROR:", error?.stderr || error);

//     res.status(500).json({
//       error: "Could not fetch video info",
//       details: error?.stderr || error.message,
//     });
//   }
// };

// // ----------------------
// // DOWNLOAD VIDEO
// // ----------------------
// exports.downloadVideo = async (req, res) => {
//   try {
//     await ensureYtDlp();

//     let { url, format } = req.query;

//     if (!url) {
//       return res.status(400).json({ error: "url query param is required" });
//     }

//     format = format || "best";

//     const ytFormat =
//       format === "bestaudio"
//         ? "bestaudio"
//         : /^\d+$/.test(format)
//         ? `${format}+bestaudio/best`
//         : "bestvideo+bestaudio/best";

//     const ext = format === "bestaudio" ? "mp3" : "mp4";

//     const outputPath = path.join(
//       os.tmpdir(),
//       `video_${Date.now()}.${ext}`
//     );

//     // ---------------- metadata ----------------
//     const metaArgs = [
//       url,
//       "--dump-json",
//       ...getCommonArgs(),
//     ];

//     const metaRaw = await safeExec(metaArgs);
//     const metadata = JSON.parse(metaRaw);

//     const safeTitle = (metadata.title || "video")
//       .replace(/[^a-zA-Z0-9_\-]/g, "_")
//       .slice(0, 80);

//     const filename = `${safeTitle}.${ext}`;

//     // ---------------- download ----------------
//     const args = [
//       url,
//       "-f",
//       ytFormat,
//       "-o",
//       outputPath,
//       ...getCommonArgs(),
//     ];

//     if (format === "bestaudio") {
//       args.push("--extract-audio", "--audio-format", "mp3");
//     }

//     console.log("Downloading:", ytFormat);

//     await safeExec(args);

//     if (!fs.existsSync(outputPath)) {
//       throw new Error("File not created");
//     }

//     res.setHeader(
//       "Content-Disposition",
//       `attachment; filename="${filename}"`
//     );

//     res.setHeader(
//       "Content-Type",
//       format === "bestaudio" ? "audio/mpeg" : "video/mp4"
//     );

//     res.download(outputPath, filename, (err) => {
//       if (err) console.error("Send error:", err);

//       fs.unlink(outputPath, () => {});
//     });

//   } catch (error) {
//     console.error("DOWNLOAD ERROR:", error?.stderr || error);

//     res.status(500).json({
//       message: "Download failed",
//       error,
//     });
//   }
// };
