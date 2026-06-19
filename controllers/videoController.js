const YTDlpWrap = require("yt-dlp-wrap").default;
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execSync } = require("child_process");

const ytDlpBinary = "yt-dlp";
const cookiesPath = path.join(process.cwd(), "cookies.txt");
const ytDlp = new YTDlpWrap(ytDlpBinary);

let ytReady = false;
let lastUpdated = 0;
const UPDATE_INTERVAL_MS = 1000 * 60 * 60 * 6;

// ----------------------
// INIT
// ----------------------
async function ensureYtDlp() {
  const now = Date.now();
  const shouldUpdate = !ytReady || now - lastUpdated > UPDATE_INTERVAL_MS;

  if (shouldUpdate) {
    try {
      console.log("[yt-dlp] Upgrading via pip...");
      execSync("pip3 install --break-system-packages --upgrade 'yt-dlp[default]'", {
        stdio: "pipe",
        timeout: 60000,
      });
      lastUpdated = now;
      console.log("[yt-dlp] Upgrade done.");
    } catch (e) {
      console.warn("[yt-dlp] pip upgrade skipped:", e.message?.substring(0, 80));
    }

    writeCookies();
    ytReady = true;
  }
}

function writeCookies() {
  if (process.env.YOUTUBE_COOKIES) {
    const content = process.env.YOUTUBE_COOKIES.replace(/\\n/g, "\n");
    fs.writeFileSync(cookiesPath, content, { encoding: "utf-8", flag: "w" });
  }
}

function detectPlatform(url) {
  if (!url) return "unknown";
  if (url.includes("youtube.com") || url.includes("youtu.be")) return "youtube";
  if (url.includes("x.com") || url.includes("twitter.com")) return "twitter";
  if (url.includes("tiktok.com")) return "tiktok";
  if (url.includes("instagram.com")) return "instagram";
  return "unknown";
}

function baseArgs(platform) {
  const args = [
    "--no-playlist",
    "--user-agent",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "--add-header", "Accept-Language: en-US,en;q=0.9",
    "--socket-timeout", "30",
    "--merge-output-format", "mp4",
    "--max-filesize", "50M",
    "--verbose",
  ];

  if (platform === "youtube") {
    args.push("--extractor-args", "youtube:player_client=web,mweb,android");
  }

  return args;
}

function safeJSONParse(data) {
  if (!data || typeof data !== "string") throw new Error("Invalid data for JSON parsing");
  const jsonMatch = data.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`No JSON in response: ${data.substring(0, 200)}`);
  return JSON.parse(jsonMatch[0]);
}

// ----------------------
// RAW EXEC — logs everything, throws with full stderr
// ----------------------
async function rawExec(args) {
  try {
    const result = await ytDlp.execPromise(args);
    return result;
  } catch (err) {
    // yt-dlp-wrap puts stderr in err.stderr — log it in full
    console.error("[yt-dlp] FULL ERROR OUTPUT:\n", err.stderr || err.message);
    throw err;
  }
}

// ----------------------
// EXEC WITH FALLBACK
// ----------------------
async function execWithFallback(url, args, platform) {
  writeCookies();
  const hasCookies = process.env.YOUTUBE_COOKIES && fs.existsSync(cookiesPath);

  // Level 1: no cookies
  try {
    return await rawExec(args);
  } catch (err) {
    console.warn("[yt-dlp] Attempt 1 failed.");
  }

  // Level 2: with cookies
  if (hasCookies) {
    try {
      console.log("[yt-dlp] Retrying with cookies...");
      return await rawExec([...args, "--cookies", cookiesPath]);
    } catch (err) {
      console.warn("[yt-dlp] Attempt 2 (cookies) failed.");
    }
  }

  // Level 3: worst quality + cookies
  console.log("[yt-dlp] Retrying minimal...");
  const minArgs = [
    url, "-f", "worst",
    "--no-playlist",
    "--socket-timeout", "30",
    "--verbose",
    "--extractor-args", "youtube:player_client=web,mweb,android",
  ];
  if (hasCookies) minArgs.push("--cookies", cookiesPath);
  return await rawExec(minArgs);
}

// ----------------------
// GET INFO
// ----------------------
exports.getVideoInfo = async (req, res) => {
  try {
    await ensureYtDlp();

    const { url } = req.query;
    if (!url) return res.status(400).json({ error: "url is required" });

    const platform = detectPlatform(url);
    const args = [url, "--dump-json", ...baseArgs(platform)];
    const data = await execWithFallback(url, args, platform);
    const metadata = safeJSONParse(data);

    const formats = metadata.formats
      ?.filter((f) => f.vcodec !== "none")
      ?.map((f) => ({
        formatId: f.format_id,
        ext: f.ext,
        resolution: f.height ? `${f.height}p` : null,
        height: f.height,
        filesize: f.filesize || null,
        hasAudio: f.acodec !== "none",
        fps: f.fps || null,
      }))
      ?.reduce((acc, curr) => {
        if (!acc.find((f) => f.height === curr.height)) acc.push(curr);
        return acc;
      }, [])
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
    console.error("INFO ERROR:", error?.stderr || error.message);
    res.status(500).json({
      error: "Failed to fetch video info",
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
    if (!url) return res.status(400).json({ error: "url is required" });

    const platform = detectPlatform(url);
    format = format || "best";

    const isAudio = format === "bestaudio";
    const ext = isAudio ? "mp3" : "mp4";

    const ytFormat = isAudio
      ? "bestaudio"
      : /^\d+$/.test(format)
      ? `${format}+bestaudio/best`
      : "bestvideo+bestaudio/best";

    const outputPath = path.join(os.tmpdir(), `video_${Date.now()}.${ext}`);

    // Log what we're working with
    console.log("[yt-dlp] Output path:", outputPath);
    console.log("[yt-dlp] Format:", ytFormat);
    console.log("[yt-dlp] Cookies exist:", fs.existsSync(cookiesPath));

    // Fetch metadata for filename
    const metaRaw = await execWithFallback(
      url,
      [url, "--dump-json", ...baseArgs(platform)],
      platform
    );
    const metadata = safeJSONParse(metaRaw);
    const safeTitle = (metadata.title || "video")
      .replace(/[^a-zA-Z0-9_\-]/g, "_")
      .slice(0, 80);
    const filename = `${safeTitle}.${ext}`;

    // Download
    const args = [url, "-f", ytFormat, "-o", outputPath, ...baseArgs(platform)];
    if (isAudio) args.push("--extract-audio", "--audio-format", "mp3");

    console.log("[yt-dlp] Running download with args:", args.join(" "));
    await execWithFallback(url, args, platform);

    // Check tmp dir for any file that was created (yt-dlp sometimes changes extension)
    const tmpFiles = fs.readdirSync(os.tmpdir()).filter(f => f.startsWith(`video_`));
    console.log("[yt-dlp] Tmp files after download:", tmpFiles);

    if (!fs.existsSync(outputPath)) {
      // Check if yt-dlp saved with a different extension
      const altPath = outputPath.replace(`.${ext}`, ".mkv");
      const altPath2 = outputPath.replace(`.${ext}`, ".webm");

      if (fs.existsSync(altPath)) {
        console.log("[yt-dlp] File saved as .mkv instead");
        return res.download(altPath, filename.replace(`.${ext}`, ".mkv"), () => {
          fs.unlink(altPath, () => {});
        });
      } else if (fs.existsSync(altPath2)) {
        console.log("[yt-dlp] File saved as .webm instead");
        return res.download(altPath2, filename.replace(`.${ext}`, ".webm"), () => {
          fs.unlink(altPath2, () => {});
        });
      }

      throw new Error("File not created after download");
    }

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", isAudio ? "audio/mpeg" : "video/mp4");

    res.download(outputPath, filename, () => {
      fs.unlink(outputPath, () => {});
    });
  } catch (error) {
    console.error("DOWNLOAD ERROR:", error?.stderr || error.message);
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
// const cookiesPath = path.join(process.cwd(), "cookies.txt");

// const ytDlp = new YTDlpWrap(ytDlpBinary);

// let ytReady = false;

// // ----------------------
// // INIT
// // ----------------------
// function ensureCookies() {
//   if (!process.env.YOUTUBE_COOKIES) return;

//   const content = process.env.YOUTUBE_COOKIES.replace(/\\n/g, "\n");

//   fs.writeFileSync(cookiesPath, content, {
//     encoding: "utf-8",
//     flag: "w",
//   });
// }

// async function ensureYtDlp() {
//   if (!ytReady) {
//     if (!fs.existsSync(ytDlpBinary)) {
//       await YTDlpWrap.downloadFromGithub(ytDlpBinary);
//     }

//     try {
//       await ytDlp.execPromise(["-U"]);
//     } catch {}

//     ensureCookies();
//     ytReady = true;
//   }
// }

// // ----------------------
// // PLATFORM DETECTION
// // ----------------------
// function detectPlatform(url) {
//   if (!url) return "unknown";

//   if (url.includes("youtube.com") || url.includes("youtu.be")) return "youtube";
//   if (url.includes("x.com") || url.includes("twitter.com")) return "twitter";
//   if (url.includes("facebook.com") || url.includes("facebook.com")) return "facebook";
//   if (url.includes("tiktok.com")) return "tiktok";
//   if (url.includes("instagram.com")) return "instagram";

//   return "unknown";
// }

// // ----------------------
// // COMMON FLAGS
// // ----------------------
// function baseArgs() {
//   return [
//     "--no-playlist",
//     "--user-agent",
//     "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
//     "--add-header",
//     "Accept-Language: en-US,en;q=0.9",
//     "--socket-timeout",
//     "30",
//     "--merge-output-format",
//     "mp4",
//     "--max-filesize",
//     "50M",
//   ];
// }

// // ----------------------
// // SMART EXEC
// // ----------------------
// async function smartExec(url, args, platform) {
//   try {
//     return await ytDlp.execPromise([...args]);
//   } catch (err) {
//     console.warn("Primary attempt failed");

//     // 🔥 YouTube fallback with cookies
//     if (
//       platform === "youtube" &&
//       process.env.YOUTUBE_COOKIES &&
//       fs.existsSync(cookiesPath)
//     ) {
//       console.log("Retrying with cookies...");

//       return await ytDlp.execPromise([
//         ...args,
//         "--cookies",
//         cookiesPath,
//       ]);
//     }

//     // 🔥 fallback lightweight format
//     console.log("Retrying with lighter format...");

//     return await ytDlp.execPromise([
//       url,
//       "-f",
//       "worst",
//       ...baseArgs(),
//     ]);
//   }
// }

// // ----------------------
// // SAFE JSON PARSE
// // ----------------------
// function safeJSONParse(data) {
//   if (!data || typeof data !== 'string') {
//     throw new Error("Invalid data for JSON parsing");
//   }

//   // Extract valid JSON from potentially mixed output (remove yt-dlp warnings/errors)
//   const jsonMatch = data.match(/^\s*\{[\s\S]*\}\s*$/);
//   if (!jsonMatch) {
//     throw new Error(`Invalid JSON response: ${data.substring(0, 100)}`);
//   }

//   try {
//     return JSON.parse(jsonMatch[0]);
//   } catch (e) {
//     throw new Error(`Failed to parse JSON: ${e.message}`);
//   }
// }

// // ----------------------
// // GET INFO
// // ----------------------
// exports.getVideoInfo = async (req, res) => {
//   try {
//     await ensureYtDlp();

//     const { url } = req.query;
//     if (!url) {
//       return res.status(400).json({ error: "url is required" });
//     }

//     const platform = detectPlatform(url);

//     const args = [
//       url,
//       "--dump-json",
//       ...baseArgs(),
//     ];

//     const data = await smartExec(url, args, platform);
//     const metadata = safeJSONParse(data);

//     const formats = metadata.formats
//       ?.filter(f => f.vcodec !== "none")
//       ?.map(f => ({
//         formatId: f.format_id,
//         ext: f.ext,
//         resolution: f.height ? `${f.height}p` : null,
//         height: f.height,
//         filesize: f.filesize,
//       }))
//       ?.sort((a, b) => (b.height || 0) - (a.height || 0));

//     res.json({
//       title: metadata.title,
//       thumbnail: metadata.thumbnail,
//       duration: metadata.duration,
//       uploader: metadata.uploader,
//       platform,
//       formats,
//     });

//   } catch (error) {
//     console.error("INFO ERROR:", error?.stderr || error);

//     res.status(500).json({
//       error: "Failed to fetch info",
//       details: error?.stderr || error.message,
//     });
//   }
// };

// // ----------------------
// // DOWNLOAD
// // ----------------------
// exports.downloadVideo = async (req, res) => {
//   try {
//     await ensureYtDlp();

//     let { url, format } = req.query;
//     if (!url) {
//       return res.status(400).json({ error: "url is required" });
//     }

//     const platform = detectPlatform(url);

//     format = format || "best";

//     let ytFormat =
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

//     // ---- metadata ----
//     const metaRaw = await smartExec(
//       url,
//       [url, "--dump-json", ...baseArgs()],
//       platform
//     );

//     const metadata = safeJSONParse(metaRaw);

//     const safeTitle = (metadata.title || "video")
//       .replace(/[^a-zA-Z0-9_\-]/g, "_")
//       .slice(0, 80);

//     const filename = `${safeTitle}.${ext}`;

//     // ---- download ----
//     const args = [
//       url,
//       "-f",
//       ytFormat,
//       "-o",
//       outputPath,
//       ...baseArgs(),
//     ];

//     if (format === "bestaudio") {
//       args.push("--extract-audio", "--audio-format", "mp3");
//     }

//     console.log(`Downloading (${platform}):`, ytFormat);

//     await smartExec(url, args, platform);

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

//     res.download(outputPath, filename, () => {
//       fs.unlink(outputPath, () => {});
//     });

//   } catch (error) {
//     console.error("DOWNLOAD ERROR:", error?.stderr || error);

//     res.status(500).json({
//       error: "Download failed",
//       details: error?.stderr || error.message,
//     });
//   }
// };

// // const YTDlpWrap = require("yt-dlp-wrap").default;
// // const path = require("path");
// // const fs = require("fs");
// // const os = require("os");

// // // paths
// // const ytDlpBinary = path.join(process.cwd(), "yt-dlp");
// // const ytDlp = new YTDlpWrap(ytDlpBinary);

// // let ytReady = false;

// // // ----------------------
// // // Ensure yt-dlp
// // // ----------------------
// // async function ensureYtDlp() {
// //   if (!ytReady) {
// //     if (!fs.existsSync(ytDlpBinary)) {
// //       console.log("Downloading yt-dlp...");
// //       await YTDlpWrap.downloadFromGithub(ytDlpBinary);
// //     }

// //     try {
// //       console.log("Updating yt-dlp...");
// //       await ytDlp.execPromise(["-U"]);
// //     } catch (e) {
// //       console.log("Update failed, continuing...");
// //     }

// //     ytReady = true;
// //   }
// // }

// // // ----------------------
// // // COMMON FLAGS (SAFE FOR PRODUCTION)
// // // ----------------------
// // function getCommonArgs() {
// //   return [
// //     "--no-playlist",
// //     "--user-agent",
// //     "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
// //     "--add-header",
// //     "Accept-Language: en-US,en;q=0.9",
// //     "--sleep-interval",
// //     "2",
// //     "--max-sleep-interval",
// //     "5",
// //   ];
// // }

// // // ----------------------
// // // SAFE EXEC WITH RETRY (NO COOKIES LOGIC)
// // // ----------------------
// // async function safeExec(args) {
// //   try {
// //     return await ytDlp.execPromise(args);
// //   } catch (err) {
// //     console.warn("yt-dlp failed, retrying without extra flags...");

// //     const cleanedArgs = args.filter(
// //       (arg) =>
// //         arg !== "--cookies" &&
// //         arg !== "--cookies-from-browser"
// //     );

// //     return await ytDlp.execPromise(cleanedArgs);
// //   }
// // }

// // // ----------------------
// // // GET VIDEO INFO
// // // ----------------------
// // exports.getVideoInfo = async (req, res) => {
// //   try {
// //     await ensureYtDlp();

// //     const { url } = req.query;

// //     if (!url) {
// //       return res.status(400).json({ error: "url query param is required" });
// //     }

// //     const args = [
// //       url,
// //       "--dump-json",
// //       ...getCommonArgs(),
// //     ];

// //     const data = await safeExec(args);
// //     const metadata = JSON.parse(data);

// //     const formats = metadata.formats
// //       ?.filter((f) => f.vcodec !== "none")
// //       ?.map((f) => ({
// //         formatId: f.format_id,
// //         ext: f.ext,
// //         resolution: f.height ? `${f.height}p` : null,
// //         height: f.height,
// //         fps: f.fps,
// //         filesize: f.filesize,
// //         hasAudio: f.acodec !== "none",
// //       }))
// //       ?.reduce((acc, curr) => {
// //         if (!acc.find((f) => f.height === curr.height)) acc.push(curr);
// //         return acc;
// //       }, [])
// //       ?.sort((a, b) => (b.height || 0) - (a.height || 0));

// //     res.json({
// //       title: metadata.title,
// //       thumbnail: metadata.thumbnail,
// //       duration: metadata.duration,
// //       uploader: metadata.uploader,
// //       formats,
// //     });

// //   } catch (error) {
// //     console.error("INFO ERROR:", error?.stderr || error);

// //     res.status(500).json({
// //       error: "Could not fetch video info",
// //       details: error?.stderr || error.message,
// //     });
// //   }
// // };

// // // ----------------------
// // // DOWNLOAD VIDEO
// // // ----------------------
// // exports.downloadVideo = async (req, res) => {
// //   try {
// //     await ensureYtDlp();

// //     let { url, format } = req.query;

// //     if (!url) {
// //       return res.status(400).json({ error: "url query param is required" });
// //     }

// //     format = format || "best";

// //     const ytFormat =
// //       format === "bestaudio"
// //         ? "bestaudio"
// //         : /^\d+$/.test(format)
// //         ? `${format}+bestaudio/best`
// //         : "bestvideo+bestaudio/best";

// //     const ext = format === "bestaudio" ? "mp3" : "mp4";

// //     const outputPath = path.join(
// //       os.tmpdir(),
// //       `video_${Date.now()}.${ext}`
// //     );

// //     // ---------------- metadata ----------------
// //     const metaArgs = [
// //       url,
// //       "--dump-json",
// //       ...getCommonArgs(),
// //     ];

// //     const metaRaw = await safeExec(metaArgs);
// //     const metadata = JSON.parse(metaRaw);

// //     const safeTitle = (metadata.title || "video")
// //       .replace(/[^a-zA-Z0-9_\-]/g, "_")
// //       .slice(0, 80);

// //     const filename = `${safeTitle}.${ext}`;

// //     // ---------------- download ----------------
// //     const args = [
// //       url,
// //       "-f",
// //       ytFormat,
// //       "-o",
// //       outputPath,
// //       ...getCommonArgs(),
// //     ];

// //     if (format === "bestaudio") {
// //       args.push("--extract-audio", "--audio-format", "mp3");
// //     }

// //     console.log("Downloading:", ytFormat);

// //     await safeExec(args);

// //     if (!fs.existsSync(outputPath)) {
// //       throw new Error("File not created");
// //     }

// //     res.setHeader(
// //       "Content-Disposition",
// //       `attachment; filename="${filename}"`
// //     );

// //     res.setHeader(
// //       "Content-Type",
// //       format === "bestaudio" ? "audio/mpeg" : "video/mp4"
// //     );

// //     res.download(outputPath, filename, (err) => {
// //       if (err) console.error("Send error:", err);

// //       fs.unlink(outputPath, () => {});
// //     });

// //   } catch (error) {
// //     console.error("DOWNLOAD ERROR:", error?.stderr || error);

// //     res.status(500).json({
// //       message: "Download failed",
// //       error,
// //     });
// //   }
// // };
