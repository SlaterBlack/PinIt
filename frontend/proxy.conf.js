const fs = require("node:fs");
const path = require("node:path");

const envPath = path.join(__dirname, ".env");
if (!fs.existsSync(envPath)) {
  throw new Error(
    "Missing frontend/.env. Copy .env.example to .env and set STOREIT_API_URL.",
  );
}
process.loadEnvFile(envPath);

const target = process.env.STOREIT_API_URL?.trim();
if (!target) {
  throw new Error(
    "STOREIT_API_URL must be set in frontend/.env.",
  );
}

let targetUrl;
try {
  targetUrl = new URL(target);
} catch {
  throw new Error(
    "STOREIT_API_URL must be an absolute http:// or https:// URL.",
  );
}

if (!["http:", "https:"].includes(targetUrl.protocol)) {
  throw new Error("STOREIT_API_URL must use http:// or https://.");
}

module.exports = {
  "/api": {
    target: target.replace(/\/+$/, ""),
    changeOrigin: true,
  },
};
