import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isIP } from "node:net";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import path from "node:path";

const host = process.argv[2] || process.env.LAN_HOST;
if (!host || isIP(host) !== 4 || host === "0.0.0.0") throw new Error("请指定本机内网 IPv4，例如 node scripts/install-lan.mjs 10.17.17.84");
const root = fileURLToPath(new URL("../", import.meta.url));
const directory = path.join(homedir(), ".config/systemd/user");
const quote = value => `"${value.replaceAll("%", "%%").replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
const unit = (description, workingDirectory, command, environment, dependencies = "") => `[Unit]
Description=${description}
After=network-online.target ${dependencies}
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${workingDirectory.replaceAll("%", "%%")}
ExecStart=${command}
${environment.map(value => `Environment=${quote(value)}`).join("\n")}
Restart=on-failure
RestartSec=3
TimeoutStopSec=30
UMask=0077

[Install]
WantedBy=default.target
`;
await mkdir(directory, { recursive: true });
await writeFile(path.join(directory, "jokerbai-blog-api.service"), unit(
  "Jokerbai Lab Rust API", path.join(root, "backend"), quote(path.join(root, "backend/target/release/yuimi-blog-server")), ["BLOG_BIND=127.0.0.1:8787"],
));
await writeFile(path.join(directory, "jokerbai-blog-web.service"), unit(
  "Jokerbai Lab LAN website", root, `${quote(process.execPath)} ${quote(path.join(root, "scripts/start-frontend.mjs"))}`,
  [`HOST=${host}`, "PORT=4321", "BLOG_API_URL=http://127.0.0.1:8787", `SITE_URL=http://${host}:4321`, "NODE_ENV=production"], "jokerbai-blog-api.service",
));
execFileSync("systemctl", ["--user", "daemon-reload"], { stdio: "inherit" });
execFileSync("systemctl", ["--user", "enable", "--now", "jokerbai-blog-api.service", "jokerbai-blog-web.service"], { stdio: "inherit" });
execFileSync("systemctl", ["--user", "restart", "jokerbai-blog-api.service", "jokerbai-blog-web.service"], { stdio: "inherit" });
console.log(`内网地址：http://${host}:4321/`);
