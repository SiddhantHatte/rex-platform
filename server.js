const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = __dirname;
const publicDir = path.join(root, "public");
const graphifyDir = path.join(root, "graphify-out");
const envPath = path.join(root, ".env");
const dataDir = process.env.REX_DATA_DIR ? path.resolve(process.env.REX_DATA_DIR) : path.join(root, "data");
const dbPath = process.env.REX_DB_PATH ? path.resolve(process.env.REX_DB_PATH) : path.join(dataDir, "rex-db.json");

loadEnv(envPath);

const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || "0.0.0.0",
  adminPassword: process.env.REX_ADMIN_PASSWORD || "",
  sessionSecret: process.env.SESSION_SECRET || "",
  geminiKey: process.env.GEMINI_API_KEY || "",
  geminiModel: process.env.GEMINI_MODEL || "gemini-2.0-flash",
  openaiKey: process.env.OPENAI_API_KEY || "",
  openaiModel: process.env.OPENAI_MODEL || "gpt-4o",
  perplexityKey: process.env.PERPLEXITY_API_KEY || "",
  perplexityModel: process.env.PERPLEXITY_MODEL || "sonar",
  githubToken: process.env.GITHUB_TOKEN || "",
  githubOwner: process.env.GITHUB_OWNER || "SiddhantHatte",
  githubPortfolioRepo: process.env.GITHUB_PORTFOLIO_REPO || "cybersecurity-portfolio",
  githubBranch: process.env.GITHUB_BRANCH || "main",
  githubDbBackupPath: process.env.GITHUB_DB_BACKUP_PATH || "rex-data/rex-db.json",
  renderExternalHostname: process.env.RENDER_EXTERNAL_HOSTNAME || ""
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/") {
      return sendFile(res, path.join(publicDir, "index.html"), "text/html; charset=utf-8");
    }

    if (req.method === "GET" && url.pathname.startsWith("/assets/")) {
      const target = safeJoin(publicDir, url.pathname.replace("/assets/", ""));
      return sendFile(res, target, contentType(target));
    }

    if (req.method === "GET" && url.pathname === "/graphify") {
      return sendFile(res, path.join(graphifyDir, "graph.html"), "text/html; charset=utf-8");
    }

    if (req.method === "GET" && url.pathname.startsWith("/graphify-out/")) {
      const target = safeJoin(graphifyDir, url.pathname.replace("/graphify-out/", ""));
      return sendFile(res, target, contentType(target));
    }

    if (req.method === "GET" && url.pathname === "/api/status") {
      return json(res, publicStatus(req));
    }

    if (req.method === "GET" && url.pathname === "/api/graphify/status") {
      return json(res, graphifyStatus());
    }

    if (req.method === "POST" && url.pathname === "/api/login") {
      const body = await readJson(req);
      return login(req, res, body.password || "");
    }

    if (req.method === "POST" && url.pathname === "/api/logout") {
      setCookie(res, "rex_session", "", { maxAge: 0 });
      return json(res, { ok: true });
    }

    if (url.pathname.startsWith("/api/") && !isAuthenticated(req)) {
      return json(res, { error: "Authentication required" }, 401);
    }

    if (req.method === "GET" && url.pathname === "/api/db") {
      return json(res, databaseSnapshot());
    }

    if (req.method === "POST" && url.pathname === "/api/db/state") {
      const body = await readJson(req);
      const saved = saveClientState(body);
      return json(res, saved);
    }

    if (req.method === "POST" && url.pathname === "/api/db/event") {
      const body = await readJson(req);
      const saved = saveClientEvent(body.type || "client-event", body.payload || {});
      return json(res, saved);
    }

    if (req.method === "POST" && url.pathname === "/api/db/backup") {
      const backup = await backupDatabaseToGitHub();
      return json(res, backup);
    }

    if (req.method === "POST" && url.pathname === "/api/rex") {
      const body = await readJson(req);
      const result = await askRex(body);
      saveClientEvent("rex-verdict", { day: body.day || "", mode: body.mode || "verify", task: body.task || "", evidence: body.evidence || body.answer || "", result });
      return json(res, result);
    }

    if (req.method === "POST" && url.pathname === "/api/research") {
      const body = await readJson(req);
      const result = await askPerplexity(body);
      return json(res, result);
    }

    if (req.method === "POST" && url.pathname === "/api/artifact") {
      const body = await readJson(req);
      const saved = await savePortfolioToGitHub(body);
      saveClientEvent("portfolio-pushed", { day: body.day || "", title: body.title || "", path: saved.path, html_url: saved.html_url });
      return json(res, saved);
    }

    if (req.method === "POST" && url.pathname === "/api/chat") {
      const body = await readJson(req);
      const result = await chatGeneral(body.system || "", body.messages || [], body.maxTokens || 900);
      saveClientEvent("chat", { messages: body.messages || [], response: result.text || "", provider: result.provider || "", fallback: Boolean(result.fallback), upstreamStatus: result.upstreamStatus || "" });
      return json(res, result);
    }

    if (req.method === "POST" && url.pathname === "/api/git/commit") {
      return json(res, { error: "Local git commit was replaced by GitHub portfolio commits. Use /api/artifact." }, 410);
    }

    json(res, { error: "Not found" }, 404);
  } catch (error) {
    json(res, { error: safeError(error) }, error.statusCode || 500);
  }
});

server.listen(config.port, config.host, () => {
  console.log(`Rex platform running at http://${config.host}:${config.port}`);
  console.log(`Auth: ${config.adminPassword && config.sessionSecret ? "enabled" : "not configured"}`);
  console.log(`Providers: Gemini=${Boolean(config.geminiKey)} OpenAI=${Boolean(config.openaiKey)} Perplexity=${Boolean(config.perplexityKey)} GitHub=${Boolean(config.githubToken)}`);
});

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function safeJoin(base, relative) {
  const target = path.normalize(path.join(base, relative));
  if (!target.startsWith(base)) throw new Error("Unsafe path");
  return target;
}

function contentType(file) {
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".md")) return "text/markdown; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".jpg") || file.endsWith(".jpeg")) return "image/jpeg";
  return "text/plain; charset=utf-8";
}

function sendFile(res, file, type) {
  if (!fs.existsSync(file)) return json(res, { error: "File not found" }, 404);
  res.writeHead(200, { "content-type": type });
  fs.createReadStream(file).pipe(res);
}

function json(res, payload, status = 200) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => {
      data += chunk;
      if (data.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function publicStatus(req) {
  return {
    ok: true,
    authenticated: isAuthenticated(req),
    authConfigured: Boolean(config.adminPassword && config.sessionSecret),
    renderUrl: config.renderExternalHostname ? `https://${config.renderExternalHostname}` : "",
    providers: {
      gemini: { configured: Boolean(config.geminiKey), model: config.geminiModel, role: "strict evidence and regression judge" },
      openai: { configured: Boolean(config.openaiKey), model: config.openaiModel, role: "Codex-style portfolio and code-quality mentor" },
      perplexity: { configured: Boolean(config.perplexityKey), model: config.perplexityModel, role: "current research and resource checker" },
      github: {
        configured: Boolean(config.githubToken),
        owner: config.githubOwner,
        repo: config.githubPortfolioRepo,
        branch: config.githubBranch,
        role: "portfolio writeup commits"
      },
      database: {
        configured: true,
        path: path.relative(root, dbPath),
        githubBackupConfigured: Boolean(config.githubToken),
        githubBackupPath: config.githubDbBackupPath,
        role: "server-side state, chat, evidence, and portfolio backup"
      }
    }
  };
}

function emptyDb() {
  const now = new Date().toISOString();
  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
    lastBackupAt: "",
    state: null,
    chatByDay: {},
    events: [],
    backups: []
  };
}

function readDb() {
  ensureDataDir();
  if (!fs.existsSync(dbPath)) return emptyDb();
  try {
    return { ...emptyDb(), ...JSON.parse(fs.readFileSync(dbPath, "utf8")) };
  } catch {
    const corruptPath = `${dbPath}.${Date.now()}.corrupt`;
    try { fs.copyFileSync(dbPath, corruptPath); } catch {}
    return emptyDb();
  }
}

function writeDb(db, options = {}) {
  ensureDataDir();
  const next = { ...db, updatedAt: new Date().toISOString() };
  const tempPath = `${dbPath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(next, null, 2));
  fs.renameSync(tempPath, dbPath);
  if (!options.skipBackup) scheduleDatabaseBackup();
  return next;
}

function ensureDataDir() {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

function databaseSnapshot() {
  const db = readDb();
  return {
    ok: true,
    state: db.state,
    chatByDay: db.chatByDay || {},
    updatedAt: db.updatedAt,
    lastBackupAt: db.lastBackupAt || "",
    backupPath: config.githubDbBackupPath,
    eventCount: Array.isArray(db.events) ? db.events.length : 0
  };
}

function saveClientState(body) {
  const db = readDb();
  const day = Number(body.day || body.state?.day || 1);
  db.state = sanitizeJson(body.state || {});
  if (!db.chatByDay) db.chatByDay = {};
  db.chatByDay[String(day)] = sanitizeJson(body.chatMessages || []);
  appendDbEvent(db, "state-sync", {
    day,
    stateKeys: Object.keys(db.state || {}),
    chatMessages: Array.isArray(body.chatMessages) ? body.chatMessages.length : 0
  });
  const saved = writeDb(db);
  return { ok: true, updatedAt: saved.updatedAt, backupQueued: Boolean(config.githubToken) };
}

function saveClientEvent(type, payload) {
  const db = readDb();
  appendDbEvent(db, String(type || "event"), sanitizeJson(payload || {}));
  const saved = writeDb(db);
  return { ok: true, updatedAt: saved.updatedAt, backupQueued: Boolean(config.githubToken) };
}

function appendDbEvent(db, type, payload) {
  if (!Array.isArray(db.events)) db.events = [];
  db.events.push({
    id: crypto.randomUUID(),
    type,
    at: new Date().toISOString(),
    payload
  });
  if (db.events.length > 1000) db.events = db.events.slice(-1000);
}

function sanitizeJson(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

let backupTimer = null;
let backupInFlight = false;

function scheduleDatabaseBackup() {
  if (!config.githubToken) return;
  if (backupTimer) clearTimeout(backupTimer);
  backupTimer = setTimeout(() => {
    backupDatabaseToGitHub().catch(error => {
      console.error(`Database backup failed: ${safeError(error)}`);
    });
  }, 1500);
}

async function backupDatabaseToGitHub() {
  if (!config.githubToken) {
    throw httpError("GITHUB_TOKEN is not configured. Database is stored locally only.", 503);
  }
  if (backupInFlight) {
    return { ok: true, queued: true, message: "Database backup already running." };
  }

  backupInFlight = true;
  try {
    const db = readDb();
    const content = JSON.stringify(db, null, 2);
    const repoPath = config.githubDbBackupPath;
    const existing = await getGitHubContent(repoPath);
    const payload = {
      message: "Back up Rex platform database",
      content: Buffer.from(content, "utf8").toString("base64"),
      branch: config.githubBranch
    };
    if (existing?.sha) payload.sha = existing.sha;

    const url = `https://api.github.com/repos/${encodeURIComponent(config.githubOwner)}/${encodeURIComponent(config.githubPortfolioRepo)}/contents/${repoPath}`;
    const response = await fetch(url, {
      method: "PUT",
      headers: githubHeaders(),
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`GitHub database backup failed with ${response.status}: ${trimProviderError(detail)}`);
    }

    const result = await response.json();
    const fresh = readDb();
    fresh.lastBackupAt = new Date().toISOString();
    fresh.backups = Array.isArray(fresh.backups) ? fresh.backups : [];
    fresh.backups.unshift({
      at: fresh.lastBackupAt,
      path: repoPath,
      commit_sha: result.commit?.sha || "",
      html_url: result.content?.html_url || ""
    });
    fresh.backups = fresh.backups.slice(0, 25);
    writeDb(fresh, { skipBackup: true });

    return {
      ok: true,
      path: repoPath,
      repo: `${config.githubOwner}/${config.githubPortfolioRepo}`,
      branch: config.githubBranch,
      html_url: result.content?.html_url || "",
      commit_sha: result.commit?.sha || ""
    };
  } finally {
    backupInFlight = false;
  }
}

function graphifyStatus() {
  const htmlPath = path.join(graphifyDir, "graph.html");
  const jsonPath = path.join(graphifyDir, "graph.json");
  const reportPath = path.join(graphifyDir, "GRAPH_REPORT.md");
  return {
    ok: true,
    available: fs.existsSync(htmlPath),
    graphUrl: "/graphify",
    jsonUrl: fs.existsSync(jsonPath) ? "/graphify-out/graph.json" : "",
    reportUrl: fs.existsSync(reportPath) ? "/graphify-out/GRAPH_REPORT.md" : "",
    generatedAt: fs.existsSync(htmlPath) ? fs.statSync(htmlPath).mtime.toISOString() : "",
    outputDir: "graphify-out"
  };
}

function login(req, res, password) {
  if (!config.adminPassword || !config.sessionSecret) {
    return json(res, { error: "REX_ADMIN_PASSWORD and SESSION_SECRET must be configured before login." }, 503);
  }

  if (!safeEqual(password, config.adminPassword)) {
    return json(res, { error: "Invalid password" }, 401);
  }

  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const token = signSession({ sub: "rex-admin", exp: expiresAt });
  setCookie(res, "rex_session", token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: isHttps(req),
    path: "/",
    maxAge: 7 * 24 * 60 * 60
  });
  return json(res, { ok: true, authenticated: true });
}

function signSession(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", config.sessionSecret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function verifySession(token) {
  if (!config.sessionSecret || !token || !token.includes(".")) return false;
  const [encoded, signature] = token.split(".");
  const expected = crypto.createHmac("sha256", config.sessionSecret).update(encoded).digest("base64url");
  if (!safeEqual(signature, expected)) return false;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    return payload.sub === "rex-admin" && Number(payload.exp) > Date.now();
  } catch {
    return false;
  }
}

function isAuthenticated(req) {
  return verifySession(parseCookies(req).rex_session);
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return Object.fromEntries(header.split(";").map(part => {
    const index = part.indexOf("=");
    if (index === -1) return ["", ""];
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(([key]) => key));
}

function setCookie(res, name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.secure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function isHttps(req) {
  return req.headers["x-forwarded-proto"] === "https" || Boolean(process.env.RENDER);
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

async function askRex(body) {
  let provider = "local-strict-fallback";
  let providerWarning = "";
  let judge;

  if (config.geminiKey) {
    try {
      judge = await askGeminiJudge(body);
      provider = "gemini";
    } catch (error) {
      providerWarning = `Gemini unavailable, using local Rex fallback: ${safeError(error)}`;
      judge = localRex(body);
    }
  } else {
    judge = localRex(body);
  }

  const result = normalizeRexResult(judge);
  result.provider = provider;
  if (providerWarning) result.warning = providerWarning;

  if (body.mode !== "regression" && result.approved) {
    if (config.openaiKey) {
      try {
        result.portfolio_markdown = await askOpenAIForPortfolio(body, result);
        result.portfolio_provider = "openai";
      } catch (error) {
        result.portfolio_markdown = buildMarkdown(body.task?.title || body.task || `Day ${body.day || ""} Evidence`, body, String(body.evidence || ""));
        result.portfolio_provider = "local-markdown-fallback";
        result.portfolio_warning = `OpenAI unavailable, using local Markdown fallback: ${safeError(error)}`;
      }
    } else {
      result.portfolio_markdown = buildMarkdown(body.task?.title || body.task || `Day ${body.day || ""} Evidence`, body, String(body.evidence || ""));
      result.portfolio_provider = "local-markdown-fallback";
    }
  }

  return result;
}

async function askGeminiJudge(body) {
  const system = rexJudgeSystem();
  const user = {
    mode: body.mode || "verify",
    current_day: body.day,
    task: body.task,
    evidence: body.evidence,
    regression_answer: body.answer,
    completed_tasks: body.completed || [],
    request: body.request || ""
  };

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.geminiModel)}:generateContent?key=${encodeURIComponent(config.geminiKey)}`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: JSON.stringify(user) }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json"
      }
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Gemini verifier failed with ${response.status}: ${trimProviderError(detail)}`);
  }

  const payload = await response.json();
  const text = payload.candidates?.flatMap(candidate => candidate.content?.parts || [])
    .map(part => part.text || "")
    .join("")
    .trim() || "{}";
  return parseRexJson(text);
}

async function askOpenAIForPortfolio(body, verdict) {
  const instructions = [
    "You are Rex's Codex-style portfolio mentor for an ethical cybersecurity learner.",
    "Transform approved evidence into polished GitHub Markdown.",
    "Do not include active credentials, live flags, private tokens, illegal instructions, or target data outside authorized labs.",
    "Keep it practical: objective, lab context, steps at a safe level, verification, lessons, remediation, regression task.",
    "Return Markdown only."
  ].join(" ");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${config.openaiKey}`
    },
    body: JSON.stringify({
      model: config.openaiModel,
      messages: [
        { role: "system", content: instructions },
        { role: "user", content: JSON.stringify({
          day: body.day,
          task: body.task,
          evidence: body.evidence,
          rex_verdict: verdict
        }) }
      ],
      max_tokens: 1800
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI portfolio writer failed with ${response.status}: ${trimProviderError(detail)}`);
  }

  const payload = await response.json();
  return (payload.choices?.[0]?.message?.content || "").trim() || buildMarkdown(body.task?.title || "Approved Evidence", body, String(body.evidence || ""));
}

async function askPerplexity(body) {
  const question = String(body.question || body.request || "").trim();
  if (!question) return { ok: false, error: "Enter a resource, topic, or learning-path question to check." };
  if (!config.perplexityKey) {
    return {
      ok: false,
      provider: "local-fallback",
      answer: "Perplexity is not configured. Add PERPLEXITY_API_KEY in .env or Render secrets to enable current resource checks.",
      citations: [],
      search_results: []
    };
  }

  const response = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${config.perplexityKey}`
    },
    body: JSON.stringify({
      model: config.perplexityModel,
      messages: [
        {
          role: "system",
          content: "You are Rex's research checker. Verify if cybersecurity learning resources, certifications, labs, and roadmaps are current. Be concise, cite sources, and warn about outdated or unsafe advice."
        },
        { role: "user", content: question }
      ]
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Perplexity research checker failed with ${response.status}: ${trimProviderError(detail)}`);
  }

  const payload = await response.json();
  return {
    ok: true,
    provider: "perplexity",
    answer: payload.choices?.[0]?.message?.content || "",
    citations: payload.citations || [],
    search_results: payload.search_results || []
  };
}

function rexJudgeSystem() {
  return [
    "You are Rex, a strict but ethical private cybersecurity instructor.",
    "Your job is to verify proof, expose vague claims, demand repeatable evidence, and protect the learner from fake progress.",
    "Never encourage illegal hacking, unauthorized access, evasion, persistence, credential theft, or harm.",
    "Approve only when the learner provides concrete evidence: platform, room/lab name, commands or approach, result, blocker, lesson learned, and artifact produced.",
    "For regression, approve only when the answer proves recall and includes an example, command, or verification step.",
    "Respond as compact JSON only with this schema: {\"approved\":boolean,\"score\":number,\"verdict\":\"...\",\"next_actions\":[\"...\"],\"portfolio_markdown\":\"\",\"regression_question\":\"...\"}. Score is 0-100."
  ].join(" ");
}

function normalizeRexResult(result) {
  return {
    approved: Boolean(result.approved),
    score: Number.isFinite(Number(result.score)) ? Math.max(0, Math.min(100, Math.round(Number(result.score)))) : 0,
    verdict: String(result.verdict || "No verdict returned."),
    next_actions: Array.isArray(result.next_actions) ? result.next_actions.map(String).slice(0, 8) : [],
    portfolio_markdown: String(result.portfolio_markdown || ""),
    regression_question: String(result.regression_question || randomRegressionQuestion())
  };
}

function parseRexJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    return {
      approved: false,
      score: 0,
      verdict: text,
      next_actions: ["Rex response was not valid JSON. Resubmit with clearer evidence."],
      portfolio_markdown: "",
      regression_question: randomRegressionQuestion()
    };
  }
}

function localRex(body) {
  const evidence = String(body.evidence || body.answer || "").trim();
  const words = evidence.split(/\s+/).filter(Boolean).length;
  const concreteSignals = [
    /tryhackme|hackthebox|portswigger|overthewire|bandit|nmap|burp|linux|github|ctf|picoctf|dvwa|metasploitable/i,
    /command|screenshot|writeup|repo|link|flag|lab|room|machine|payload|request|response/i,
    /learned|blocked|fixed|result|completed|solved|submitted|notes/i
  ].filter(rx => rx.test(evidence)).length;

  if (body.mode === "regression") {
    const approved = words >= 45 && concreteSignals >= 2;
    return {
      approved,
      score: approved ? 76 : Math.min(55, words),
      verdict: approved
        ? "Accepted for now. You gave enough operational detail to show memory, not just recognition."
        : "Rejected. Your regression answer is too thin. Explain the concept, give one command or example, and state how you would verify the result.",
      next_actions: approved
        ? ["Add this explanation to your notes.", "Redo this topic in 72 hours without looking."]
        : ["Write a 5-line explanation.", "Add one concrete command, payload, or HTTP example.", "State one failure mode or false positive."],
      portfolio_markdown: "",
      regression_question: randomRegressionQuestion()
    };
  }

  const approved = words >= 70 && concreteSignals >= 2;
  const score = approved ? Math.min(92, 65 + words / 8 + concreteSignals * 4) : Math.min(59, words + concreteSignals * 10);
  return {
    approved,
    score: Math.round(score),
    verdict: approved
      ? "Approved. This evidence is specific enough to count. Do not get comfortable: save the writeup and schedule regression."
      : "Rejected. Rex does not accept vibes, effort claims, or motivational paragraphs. Show platform, lab, commands/approach, result, blocker, and artifact.",
    next_actions: approved
      ? ["Save the generated portfolio note.", "Commit your portfolio folder.", "Run one regression question before ending the day."]
      : ["Name the exact platform and lab.", "List the commands, payloads, or steps you used.", "State the result and one thing you learned.", "Attach or paste a GitHub/writeup link when available."],
    portfolio_markdown: "",
    regression_question: randomRegressionQuestion()
  };
}

function buildMarkdown(title, body, evidence) {
  const day = body.day || "N/A";
  const date = new Date().toISOString().slice(0, 10);
  return `# Day ${day}: ${title}

**Date:** ${date}

## Objective
${body.task?.objective || body.task?.title || title}

## Evidence
${evidence}

## Verification
- Evidence reviewed by Rex.
- Status: Accepted.
- Regression required within 72 hours.

## Safety Boundary
All work was performed in authorized labs, CTFs, or permitted learning environments.

## Next Steps
- Rebuild the key steps from memory.
- Add screenshots or terminal output where safe.
- Keep public notes free of credentials, private tokens, and active challenge flags.
`;
}

function randomRegressionQuestion() {
  const questions = [
    "Explain TCP three-way handshake and name one sign of a SYN scan in logs.",
    "What does the Linux permission 750 mean, and when would it matter in privilege escalation?",
    "Explain reflected XSS versus stored XSS with one safe lab example.",
    "What is IDOR, and what evidence proves impact without accessing unauthorized data?",
    "Write the difference between nmap -sS, -sV, and -A in plain terms.",
    "What makes a bug bounty report actionable: endpoint, steps, impact, or screenshot? Explain all four.",
    "Explain SQL injection with a harmless PortSwigger-style example.",
    "What should you never include in a public CTF or bug bounty writeup?"
  ];
  return questions[Math.floor(Math.random() * questions.length)];
}

async function savePortfolioToGitHub(body) {
  if (!config.githubToken) {
    throw httpError("GITHUB_TOKEN is not configured. Add a GitHub token with Contents read/write access.", 503);
  }

  const title = body.title || `day-${body.day || "note"}`;
  const safeTitle = slug(title).slice(0, 80) || "note";
  const date = new Date().toISOString().slice(0, 10);
  const repoPath = `portfolio/${date}-${safeTitle}.md`;
  const content = String(body.content || "").trim();
  if (!content) throw new Error("Nothing to save.");

  const existing = await getGitHubContent(repoPath);
  const payload = {
    message: body.message || `Add Rex portfolio note: ${safeTitle}`,
    content: Buffer.from(content, "utf8").toString("base64"),
    branch: config.githubBranch
  };
  if (existing?.sha) payload.sha = existing.sha;

  const url = `https://api.github.com/repos/${encodeURIComponent(config.githubOwner)}/${encodeURIComponent(config.githubPortfolioRepo)}/contents/${repoPath}`;
  const response = await fetch(url, {
    method: "PUT",
    headers: githubHeaders(),
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`GitHub portfolio commit failed with ${response.status}: ${trimProviderError(detail)}`);
  }

  const result = await response.json();
  return {
    ok: true,
    path: repoPath,
    repo: `${config.githubOwner}/${config.githubPortfolioRepo}`,
    branch: config.githubBranch,
    html_url: result.content?.html_url || "",
    commit_sha: result.commit?.sha || ""
  };
}

async function getGitHubContent(repoPath) {
  const url = `https://api.github.com/repos/${encodeURIComponent(config.githubOwner)}/${encodeURIComponent(config.githubPortfolioRepo)}/contents/${repoPath}?ref=${encodeURIComponent(config.githubBranch)}`;
  const response = await fetch(url, { headers: githubHeaders() });
  if (response.status === 404) return null;
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`GitHub lookup failed with ${response.status}: ${trimProviderError(detail)}`);
  }
  return response.json();
}

function githubHeaders() {
  return {
    "accept": "application/vnd.github+json",
    "authorization": `Bearer ${config.githubToken}`,
    "content-type": "application/json",
    "user-agent": "rex-cybersecurity-instructor",
    "x-github-api-version": "2022-11-28"
  };
}

function extractOpenAIText(payload) {
  if (payload.output_text) return payload.output_text;
  const output = payload.output || [];
  return output.flatMap(item => item.content || [])
    .map(part => part.text || part.output_text || "")
    .join("");
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function trimProviderError(detail) {
  return String(detail || "").replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]").slice(0, 800);
}

function safeError(error) {
  return trimProviderError(error?.message || String(error));
}

function httpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function chatGeneral(system, messages, maxTokens) {
  if (!config.geminiKey) {
    return {
      text: localChatFallback(system, messages, "Gemini is not configured"),
      provider: "local-fallback",
      fallback: true
    };
  }

  const geminiMessages = messages.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }]
  }));

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.geminiModel)}:generateContent?key=${encodeURIComponent(config.geminiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: geminiMessages,
          generationConfig: {
            maxOutputTokens: maxTokens || 900,
            temperature: 0.7
          }
        })
      }
    );

    if (!response.ok) {
      const detail = await response.text();
      return {
        text: localChatFallback(system, messages, `Gemini returned ${response.status}`),
        provider: "local-fallback",
        fallback: true,
        upstreamStatus: response.status,
        detail: trimProviderError(detail)
      };
    }

    const payload = await response.json();
    const text = payload.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return { text, provider: "gemini" };
  } catch (err) {
    return {
      text: localChatFallback(system, messages, "Gemini connection failed"),
      provider: "local-fallback",
      fallback: true,
      detail: safeError(err)
    };
  }
}

function localChatFallback(system, messages, reason) {
  const transcript = messages.map(m => `${m.role}: ${m.content}`).join("\n");
  const lastUser = [...messages].reverse().find(m => m.role === "user")?.content || "";

  if (/professional cybersecurity technical writer/i.test(system)) {
    return localWritingFallback(lastUser, reason);
  }

  if (/exhausted and want to quit/i.test(system)) {
    return [
      "Recruit. AI quota is rate-limited, so local Rex is taking over.",
      "You are tired. Noted. The mission is now small enough to finish.",
      "",
      "Minimum task: spend 25 minutes on one lab command, write three bullets about what happened, and save the note.",
      "Report back with the exact command, output, and one thing you understood."
    ].join("\n");
  }

  if (/Commander Rex|VERDICT|drill instructor/i.test(system)) {
    return localRexChatFallback(transcript, lastUser, reason);
  }

  return [
    "Local Rex fallback is active because the upstream AI is unavailable.",
    "",
    "Ask a concrete cybersecurity question, include the command or lab name, and I will answer from the built-in training rules."
  ].join("\n");
}

function localRexChatFallback(transcript, lastUser, reason) {
  const text = `${transcript}\n${lastUser}`.trim();
  const words = text.split(/\s+/).filter(Boolean).length;
  const concreteSignals = [
    /overthewire|bandit|tryhackme|hackthebox|portswigger|picoctf|dvwa|kali|virtualbox|github/i,
    /\bssh\b|\bcat\b|\bls\b|\bfile\b|\bfind\b|\bnmap\b|\bburp\b|\bgit\b|\bcommit\b/i,
    /output|result|learned|blocked|fixed|repo|notes|level|tcp|dns|http/i
  ].filter(rx => rx.test(text)).length;
  const gibberish = /([a-z])\1{12,}|[;]{4,}|[a-z]{35,}/i.test(lastUser);

  if (gibberish || words < 35 || concreteSignals < 2) {
    return [
      `Recruit. Gemini is unavailable right now (${reason}), so local Rex is judging this.`,
      "",
      "Rejected. Your submission does not prove work. It is vague, unreadable, or missing technical evidence.",
      "",
      "Resubmit with:",
      "1. Exact platform and lab name.",
      "2. Exact commands you ran.",
      "3. What output you saw.",
      "4. One blocker or mistake.",
      "5. One thing you learned well enough to repeat tomorrow.",
      "",
      "[VERDICT:REJECTED|Evidence is vague or unreadable. Redo the work and submit commands, outputs, and lessons learned.]"
    ].join("\n");
  }

  if (words >= 90 && concreteSignals >= 3) {
    return [
      `Recruit. Gemini is unavailable right now (${reason}), so local Rex is interrogating you in fallback mode.`,
      "",
      "Answer these before approval:",
      "1. Which exact Bandit level taught you the most, and what command solved it?",
      "2. Explain TCP versus UDP in one practical sentence.",
      "3. Paste the GitHub repo name and the commit message you used for Day 1.",
      "",
      "No verdict yet. Prove recall, not recognition."
    ].join("\n");
  }

  return [
    `Recruit. Gemini is unavailable right now (${reason}), so local Rex is judging this.`,
    "",
    "Rejected for insufficient detail. You have some signals, but not enough repeatable evidence.",
    "Add the missing commands, outputs, and the GitHub commit proof.",
    "",
    "[VERDICT:REJECTED|Evidence lacks enough concrete commands, outputs, and artifact proof.]"
  ].join("\n");
}

function localWritingFallback(prompt, reason) {
  const clean = String(prompt || "").split("Context from recruit").pop()?.trim() || String(prompt || "").trim();
  return [
    `<!-- Local writing fallback active: ${reason}. Refine this draft after provider quota recovers. -->`,
    "",
    "# Cybersecurity Learning Log",
    "",
    "## Context",
    clean || "Add the lab, commands, outputs, and lessons here.",
    "",
    "## Work Completed",
    "- Document the platform and exact lab or room.",
    "- List the commands or tools used.",
    "- Record the important output without secrets or active flags.",
    "",
    "## Lessons Learned",
    "- Explain the concept in your own words.",
    "- Note one mistake or blocker.",
    "- Add one regression question to answer tomorrow.",
    "",
    "## Next Step",
    "Repeat the key command from memory and commit the note to GitHub."
  ].join("\n");
}
