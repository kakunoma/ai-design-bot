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

// ─── はてなブックマーク（RSS版：JSON検索APIは廃止済みのため） ─────
// ページ全体を対象にした検索のため、サイドバー等の無関係な文言も拾ってしまう。
// タイトルに「AI」＋「デザイン系ワード」が両方含まれる記事のみ採用してノイズを除去する。
function isRelevantTitle(title) {
  const hasAI = /AI|ai|人工知能|生成AI/i.test(title);
  const hasDesignWord = /デザイ|UX|UI|ux|ui/i.test(title); // 「デザイ」でデザイン/デザイナー等を包括
  return hasAI && hasDesignWord;
}

function decodeXmlEntities(text) {
  return text
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

function fetchText(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      // 3xxリダイレクトを手動で追跡（JSON検索APIはHTMLへ、RSSはXMLのままリダイレクトされる）
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirected = new URL(res.headers.location, url).toString();
        res.resume();
        resolve(fetchText(redirected, options));
        return;
      }
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.end();
  });
}

async function fetchHatena() {
  const articles = [];
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  for (const kw of KEYWORDS) {
    const query = encodeURIComponent(kw);
    const url = `https://b.hatena.ne.jp/search/text?q=${query}&sort=recent&safe=on&target=text&mode=rss`;
    try {
      const xml = await fetchText(url, {
        method: "GET",
        headers: { "User-Agent": "ai-design-bot/1.0" },
      });

      const itemBlocks = xml.split(/<item /).slice(1);
      for (const block of itemBlocks) {
        const linkMatch = block.match(/<link>([\s\S]*?)<\/link>/);
        const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/);
        const dateMatch = block.match(/<dc:date>([\s\S]*?)<\/dc:date>/);
        const countMatch = block.match(/<hatena:bookmarkcount>(\d+)<\/hatena:bookmarkcount>/);

        if (!linkMatch || !titleMatch || !dateMatch) continue;

        const pubDate = new Date(dateMatch[1]);
        if (pubDate < cutoff) continue;

        const title = decodeXmlEntities(titleMatch[1]);
        if (!isRelevantTitle(title)) continue; // タイトル無関係なら除外（ノイズ対策）

        articles.push({
          title,
          url: decodeXmlEntities(linkMatch[1]),
          score: countMatch ? parseInt(countMatch[1], 10) : 0,
          source: "はてブ",
          body: "",
        });
      }
    } catch (e) {
      console.error(`Hatena fetch error (${kw}):`, e.message);
    }
  }
  return articles;
}

// ─── デザイン専門メディア（Goodpatch Blog / Spectrum Tokyo） ─────
// これらはデザイン特化メディアのため、タイトルの「デザイン系ワード」チェックは不要。
// 「AI」関連ワードが含まれる記事のみに絞る。
function hasAIWord(title) {
  return /AI|ai|人工知能|生成AI/i.test(title);
}

async function fetchWordPressRss(feedUrl, sourceName, cutoffDays = 1) {
  const articles = [];
  const cutoff = new Date(Date.now() - cutoffDays * 24 * 60 * 60 * 1000);

  try {
    const xml = await fetchText(feedUrl, {
      method: "GET",
      headers: { "User-Agent": "ai-design-bot/1.0" },
    });

    const itemBlocks = xml.split(/<item>/).slice(1);
    for (const block of itemBlocks) {
      const titleMatch = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
      const linkMatch = block.match(/<link>([\s\S]*?)<\/link>/);
      const dateMatch = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/);

      if (!titleMatch || !linkMatch || !dateMatch) continue;

      const pubDate = new Date(dateMatch[1]);
      if (pubDate < cutoff) continue;

      const title = decodeXmlEntities(titleMatch[1]);
      if (!hasAIWord(title)) continue; // デザイン特化メディアなのでAI関連のみ抽出

      articles.push({
        title,
        url: decodeXmlEntities(linkMatch[1]),
        score: 20, // 参考にする「いいね数」等がないため、デザイン専門メディア由来として高めの固定スコアを付与
        source: sourceName,
        body: "",
      });
    }
  } catch (e) {
    console.error(`${sourceName} fetch error:`, e.message);
  }
  return articles;
}

function fetchGoodpatchBlog() {
  // デザイン専門ブログは更新頻度が低いため24hでは0件になりがちだが、
  // 同じ記事が出続ける期間を最大2日に抑えるため7日ではなく2日を採用
  return fetchWordPressRss("https://goodpatch.com/blog/feed", "Goodpatch Blog", 2);
}

function fetchSpectrumTokyo() {
  return fetchWordPressRss("https://spectrumtokyo.com/jp/feed", "Spectrum Tokyo", 2);
}

// ─── note（ハッシュタグRSS） ────────────────────────────
// note公式APIはないが、ハッシュタグ単位のRSSは生きている（新着順・人気順ではない）。
// タイトルにAI×デザイン系ワードが両方含まれる記事のみ採用してノイズを除去する。
async function fetchNote() {
  const articles = [];
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const url = "https://note.com/hashtag/AI%E3%83%87%E3%82%B6%E3%82%A4%E3%83%B3/rss";

  try {
    const xml = await fetchText(url, {
      method: "GET",
      headers: { "User-Agent": "ai-design-bot/1.0" },
    });

    const itemBlocks = xml.split(/<item>/).slice(1);
    for (const block of itemBlocks) {
      const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/);
      const linkMatch = block.match(/<link>([\s\S]*?)<\/link>/);
      const dateMatch = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/);

      if (!titleMatch || !linkMatch || !dateMatch) continue;

      const pubDate = new Date(dateMatch[1]);
      if (pubDate < cutoff) continue;

      const title = decodeXmlEntities(titleMatch[1]);
      if (!isRelevantTitle(title)) continue; // AI×デザイン系ワードの両方が必須

      articles.push({
        title,
        url: decodeXmlEntities(linkMatch[1]),
        score: 5, // ブックマーク数等の指標がないため固定スコア
        source: "note",
        body: "",
      });
    }
  } catch (e) {
    console.error("note fetch error:", e.message);
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

  await postJson(SLACK_WEBHOOK_URL, {
    text: lines.join("\n"),
    unfurl_links: false,
    unfurl_media: false,
  });
  console.log("Slack投稿完了");
}

// ─── メイン ──────────────────────────────────────────────
async function main() {
  console.log("記事収集開始...");

  const [qiita, zenn, hatena, goodpatch, spectrum, note] = await Promise.all([
    fetchQiita(),
    fetchZenn(),
    fetchHatena(),
    fetchGoodpatchBlog(),
    fetchSpectrumTokyo(),
    fetchNote(),
  ]);

  console.log(
    `取得件数 Qiita:${qiita.length} Zenn:${zenn.length} はてブ:${hatena.length} Goodpatch:${goodpatch.length} SpectrumTokyo:${spectrum.length} note:${note.length}`
  );

  const top = dedupeAndRank([...qiita, ...zenn, ...hatena, ...goodpatch, ...spectrum, ...note]);

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