const https = require("https");

// ─── 設定 ───────────────────────────────────────────────
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

const KEYWORDS = ["AIデザイン", "AI UX", "AI UI", "生成AI デザイン", "AIデザイナー"];
const TOP_N = 5;

// ─── ユーティリティ ──────────────────────────────────────
function fetchJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`JSON parse error: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function postJson(url, payload) {
  const body = JSON.stringify(payload);
  const urlObj = new URL(url);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve(data));
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function since24h() {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

// ─── Qiita ───────────────────────────────────────────────
async function fetchQiita() {
  const articles = [];
  for (const kw of KEYWORDS) {
    const query = encodeURIComponent(`${kw} created:>${since24h().slice(0, 10)}`);
    const url = `https://qiita.com/api/v2/items?query=${query}&per_page=20&sort=like`;
    try {
      const data = await fetchJson(url, {
        method: "GET",
        headers: { "User-Agent": "ai-design-bot/1.0" },
      });
      if (Array.isArray(data)) {
        for (const item of data) {
          articles.push({
            title: item.title,
            url: item.url,
            score: item.likes_count || 0,
            source: "Qiita",
            body: item.body?.slice(0, 500) || "",
          });
        }
      }
    } catch (e) {
      console.error(`Qiita fetch error (${kw}):`, e.message);
    }
  }
  return articles;
}

// ─── Zenn ────────────────────────────────────────────────
async function fetchZenn() {
  const articles = [];
  for (const kw of KEYWORDS) {
    const query = encodeURIComponent(kw);
    const url = `https://zenn.dev/api/articles?order=latest&count=20&source=&q=${query}`;
    try {
      const data = await fetchJson(url, {
        method: "GET",
        headers: { "User-Agent": "ai-design-bot/1.0" },
      });
      if (data?.articles) {
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
        for (const item of data.articles) {
          if (new Date(item.published_at) >= cutoff) {
            articles.push({
              title: item.title,
              url: `https://zenn.dev${item.path}`,
              score: item.liked_count || 0,
              source: "Zenn",
              body: item.body?.slice(0, 500) || "",
            });
          }
        }
      }
    } catch (e) {
      console.error(`Zenn fetch error (${kw}):`, e.message);
    }
  }
  return articles;
}

// ─── はてなブックマーク ──────────────────────────────────
async function fetchHatena() {
  const articles = [];
  for (const kw of KEYWORDS) {
    const query = encodeURIComponent(kw);
    const url = `https://b.hatena.ne.jp/search/text?q=${query}&sort=recent&safe=on&target=entry&ie=UTF-8&output=json`;
    try {
      const data = await fetchJson(url, {
        method: "GET",
        headers: { "User-Agent": "ai-design-bot/1.0" },
      });
      const items = data?.bookmarks || data?.items || [];
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      for (const item of items) {
        const date = new Date(item.created || item.bookmarked_data?.timestamp || 0);
        if (date >= cutoff) {
          articles.push({
            title: item.title || item.entry?.title || "",
            url: item.link || item.entry?.url || "",
            score: item.count || item.entry?.count || 0,
            source: "はてブ",
            body: item.description || item.entry?.description || "",
          });
        }
      }
    } catch (e) {
      console.error(`Hatena fetch error (${kw}):`, e.message);
    }
  }
  return articles;
}

// ─── 重複除去 & ランキング ───────────────────────────────
function dedupeAndRank(articles) {
  const seen = new Set();
  const unique = [];
  for (const a of articles) {
    if (!a.url || seen.has(a.url)) continue;
    seen.add(a.url);
    unique.push(a);
  }
  return unique.sort((a, b) => b.score - a.score).slice(0, TOP_N);
}

// ─── Slack 投稿 ──────────────────────────────────────────
async function postToSlack(articles) {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const emojis = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"];

  const lines = [`${mm}/${dd}のAI×デザイン注目記事`, ""];
  for (let i = 0; i < articles.length; i++) {
    const a = articles[i];
    lines.push(`${emojis[i]} ${a.title}`);
    lines.push(a.url);
    if (i < articles.length - 1) lines.push("");
  }

  await postJson(SLACK_WEBHOOK_URL, { text: lines.join("\n") });
  console.log("Slack投稿完了");
}

// ─── メイン ──────────────────────────────────────────────
async function main() {
  console.log("記事収集開始...");

  const [qiita, zenn, hatena] = await Promise.all([
    fetchQiita(),
    fetchZenn(),
    fetchHatena(),
  ]);

  console.log(`取得件数 Qiita:${qiita.length} Zenn:${zenn.length} はてブ:${hatena.length}`);

  const top = dedupeAndRank([...qiita, ...zenn, ...hatena]);

  if (top.length === 0) {
    console.log("該当記事なし。投稿をスキップします。");
    return;
  }

  await postToSlack(top);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
