import { createServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { randomInt } from "node:crypto";
import { networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";
import { createBridgeServer, loadToken } from "./bridge.mjs";

const port = Number(process.env.POCKET_BRIDGE_PORT || 15731);
const panelPort = Number(process.env.POCKET_PANEL_PORT || 15732);
const token = loadToken();
let code = String(randomInt(100000, 1000000));
let expiresAt = Date.now() + 10 * 60_000;
const attempts = new Map();
const apk = fileURLToPath(
  new URL("./release/Codex-Pocket.apk", import.meta.url),
);
const addresses = () =>
  Object.entries(networkInterfaces())
    .flatMap(([name, entries]) =>
      entries
        .filter((x) => x && x.family === "IPv4" && !x.internal)
        .map((x) => ({
          address: x.address,
          priority: /vmware|virtual|hyper-v|veth|loopback|tunnel/i.test(name)
            ? 20
            : /wi-?fi|wlan/i.test(name)
              ? 0
              : /ethernet|以太网/i.test(name) ? 5 : 10,
        })),
    )
    .sort((a, b) => a.priority - b.priority || a.address.localeCompare(b.address))
    .map((x) => `http://${x.address}:${port}`);
function json(res, status, value, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(JSON.stringify(value));
}
const running = createBridgeServer({
  token,
  listenPort: port,
  publicHandler: async (req, res, cors) => {
    if (req.url === "/download" && req.method === "GET") {
      if (!existsSync(apk)) {
        json(res, 404, { message: "APK 尚未生成" });
        return true;
      }
      res.writeHead(200, {
        "Content-Type": "application/vnd.android.package-archive",
        "Content-Disposition": 'attachment; filename="Codex-Pocket.apk"',
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      });
      createReadStream(apk).pipe(res);
      return true;
    }
    if (req.url !== "/pair" || req.method !== "POST") return false;
    const ip = req.socket.remoteAddress;
    let rate = attempts.get(ip);
    if (!rate || Date.now() - rate.since > 60_000) {
      rate = { since: Date.now(), count: 0 };
      attempts.set(ip, rate);
    }
    if (attempts.size > 1000) attempts.clear();
    if (++rate.count > 5) {
      json(res, 429, { message: "尝试次数过多，请一分钟后重试" }, cors);
      return true;
    }
    try {
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 1024) throw new Error("请求过长");
      }
      if (Date.now() > expiresAt || String(JSON.parse(raw).code) !== code) {
        json(
          res,
          401,
          { message: "配对码错误或已过期，请在电脑端刷新配对码" },
          cors,
        );
        return true;
      }
      json(res, 200, { token }, cors);
      code = String(randomInt(100000, 1000000));
      expiresAt = Date.now() + 10 * 60_000;
    } catch {
      json(res, 400, { message: "配对请求格式错误" }, cors);
    }
    return true;
  },
});

const page = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Codex Pocket · 电脑桥</title><style>
:root{color-scheme:dark;font:16px/1.65 system-ui,sans-serif;color:#eef5f7;background:#090d16}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(ellipse at 10% 0,#19393380,transparent 55%),radial-gradient(ellipse at 90% 100%,#32235270,transparent 60%);padding:48px 24px}main{max-width:760px;margin:auto}header{display:flex;align-items:center;gap:12px;color:#b7c5d4;font-weight:700}.mark{display:grid;place-items:center;width:40px;height:40px;background:linear-gradient(135deg,#80e7d5,#9589ff);color:#0a1018;border-radius:12px}h1{font-size:40px;letter-spacing:-2px;margin:36px 0 8px}p{color:#a2adc0}section{background:#141b289c;border:1px solid #ffffff15;border-radius:22px;padding:26px;margin-top:24px}label{display:block;color:#a7b7c5;margin-bottom:8px}select{width:100%;border:1px solid #ffffff22;background:#0e1523;color:#eef5f7;padding:13px;border-radius:10px;font:inherit}#code{font:600 46px/1.3 ui-monospace,monospace;letter-spacing:10px;color:#80e7d5;margin:14px 0}button,a{display:inline-block;background:#80e7d5;color:#0a1218;font:600 14px system-ui;border:0;border-radius:10px;padding:13px 18px;cursor:pointer;text-decoration:none}button.secondary{background:#ffffff10;color:#becadb}small{color:#98a7b8}#status{display:block;margin-top:16px}#download{word-break:break-all;color:#80e7d5;background:transparent;padding:0}footer{font-size:13px;color:#7f8ca0;margin-top:26px}ol{padding-left:22px}li{padding:4px 0}@media(max-width:550px){body{padding:24px 16px}h1{font-size:31px}section{padding:20px}}
</style><main><header><span class="mark">↗</span>Codex Pocket / 电脑桥</header><h1>电脑在工作，手机随时接上。</h1><p>沿用电脑上 cc-switch 当前的 Codex 配置。手机与电脑可连接同一 Wi-Fi，或加入同一私人 VPN。</p><section><label for="address">1 · 手机 App 中填写此电脑地址</label><select id="address"></select><label style="margin-top:22px">2 · 输入一次性配对码</label><div id="code">••••••</div><small id="expiry"></small><div style="margin-top:20px;display:flex;gap:10px;flex-wrap:wrap"><button id="refresh">生成新配对码</button><button class="secondary" id="copy">复制配对信息</button></div><small id="status" role="status"></small></section><section><b>还没安装手机 App？</b><p>将 APK 发到 Android 手机，或在手机打开下面的下载地址：</p><a id="download"></a><ol><li>安装 Codex Pocket，打开“连接电脑”。</li><li>填入上方地址和配对码，点“连接”。</li><li>进入会话，发送任务；需要授权时在手机审批。</li></ol><small>如果连接失败，检查 Windows 防火墙是否允许 Node.js 通过专用网络。电脑桥需要保持运行。</small></section><footer>手机可通过后台电脑桥发送消息和审批，无需打开 Codex 窗口。首次配对后可运行 Enable-Background.cmd 设置登录后自动启动；电脑需保持开机和登录，可锁屏使用。远程使用请通过自己的 VPN 或 HTTPS 反向代理。</footer></main><script>
let setup;async function load(){const r=await fetch('/api/setup');setup=await r.json();const address=document.querySelector('#address');const old=address.value;address.replaceChildren(...setup.urls.map(url=>Object.assign(document.createElement('option'),{textContent:url + (url.startsWith('http://100.')?' · VPN 地址':''),value:url})));if(setup.urls.includes(old))address.value=old;document.querySelector('#code').textContent=setup.code;document.querySelector('#expiry').textContent='有效期至 '+new Date(setup.expiresAt).toLocaleTimeString();download();}function download(){const a=document.querySelector('#download');a.href=document.querySelector('#address').value+'/download';a.textContent=a.href;}document.querySelector('#address').onchange=download;document.querySelector('#refresh').onclick=async()=>{await fetch('/api/rotate',{method:'POST'});load();};document.querySelector('#copy').onclick=async()=>{try{await navigator.clipboard.writeText(JSON.stringify({url:document.querySelector('#address').value,code:setup.code}));document.querySelector('#status').textContent='已复制。在手机 App 的“粘贴配对信息”中使用。';}catch{document.querySelector('#status').textContent='请在手机填写地址和上方六位配对码。';}};load();setInterval(load,10000);
</script></html>`;

const panel = createServer((req, res) => {
  if (
    req.headers.host !== `127.0.0.1:${panelPort}` &&
    req.headers.host !== `localhost:${panelPort}`
  ) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (
    req.headers.origin &&
    ![
      `http://127.0.0.1:${panelPort}`,
      `http://localhost:${panelPort}`,
    ].includes(req.headers.origin)
  ) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (req.url === "/api/setup") {
    json(res, 200, {
      urls: addresses().length ? addresses() : [`http://127.0.0.1:${port}`],
      code,
      expiresAt,
    });
    return;
  }
  if (req.url === "/api/rotate" && req.method === "POST") {
    code = String(randomInt(100000, 1000000));
    expiresAt = Date.now() + 10 * 60_000;
    json(res, 200, { ok: true });
    return;
  }
  if (req.url !== "/") {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Frame-Options": "DENY",
  });
  res.end(page);
});
panel.listen(panelPort, "127.0.0.1", () =>
  console.log(`配对页面：http://127.0.0.1:${panelPort}`),
);
function shutdown() {
  running.bridge.close();
  running.server.close();
  panel.close();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
running.server.on("error", (error) => {
  console.error(error.message);
  shutdown();
  process.exitCode = 1;
});
panel.on("error", (error) => {
  console.error(error.message);
  shutdown();
  process.exitCode = 1;
});
