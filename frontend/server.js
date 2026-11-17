const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");

const envPath = path.join(__dirname, ".env");
if (!fs.existsSync(envPath)) {
  throw new Error(
    "Missing frontend/.env. Copy .env.example to .env and configure the service.",
  );
}
process.loadEnvFile(envPath);

const HOST = process.env.FRONTEND_HOST?.trim();
const PORT_VALUE = process.env.FRONTEND_PORT?.trim();
const API_TARGET = process.env.STOREIT_API_URL?.trim();
const BROWSER_DIR = path.join(__dirname, "dist", "pinit", "browser");
const INDEX_PATH = path.join(BROWSER_DIR, "index.html");

if (!HOST) {
  throw new Error("FRONTEND_HOST must be set in frontend/.env.");
}
if (!PORT_VALUE) {
  throw new Error("FRONTEND_PORT must be set in frontend/.env.");
}
const PORT = Number(PORT_VALUE);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error("FRONTEND_PORT must be an integer from 1 to 65535.");
}
if (!API_TARGET) {
  throw new Error("STOREIT_API_URL must be set in frontend/.env.");
}

let targetUrl;
try {
  targetUrl = new URL(API_TARGET);
} catch {
  throw new Error(
    "STOREIT_API_URL must be an absolute http:// or https:// URL.",
  );
}

if (!["http:", "https:"].includes(targetUrl.protocol)) {
  throw new Error("STOREIT_API_URL must use http:// or https://.");
}
if (!fs.existsSync(INDEX_PATH)) {
  throw new Error(
    "PinIT production build not found. Run npm run build before npm run serve.",
  );
}

const app = express();

app.use(
  "/api",
  createProxyMiddleware({
    target: API_TARGET.replace(/\/+$/, ""),
    changeOrigin: true,
    pathRewrite: (requestPath) => `/api${requestPath}`,
    on: {
      proxyReq(proxyReq, req) {
        const clientIp = req.socket.remoteAddress;
        if (clientIp) {
          proxyReq.setHeader("X-Forwarded-For", clientIp);
        }
      },
    },
  }),
);
app.use(express.static(BROWSER_DIR));
app.get(/.*/, (_req, res) => {
  res.sendFile(INDEX_PATH);
});

app.listen(PORT, HOST, () => {
  console.log(
    `PinIT frontend listening on http://${HOST}:${PORT}, proxying /api to ${API_TARGET}`,
  );
});
