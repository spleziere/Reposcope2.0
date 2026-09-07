import mermaid from "https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.esm.min.mjs";

mermaid.initialize({
  startOnLoad: false,
  theme: "base",
  flowchart: { useMaxWidth: false, htmlLabels: true, curve: "basis" },
  themeVariables: {
    background: "#05070d",
    primaryColor: "#0f172a",
    primaryBorderColor: "#334155",
    primaryTextColor: "#e2e8f0",
    lineColor: "#475569",
    fontFamily: "Inter",
    fontSize: "14px",
  },
});

const IGNORED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "coverage",
  ".turbo", "vendor", "target", ".venv", "venv", "__pycache__",
]);

const CODE_EXT = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "go", "rb", "java",
  "kt", "kts", "rs", "vue", "svelte", "c", "h", "cpp", "hpp", "cs",
  "php", "swift", "m", "scala", "dart",
]);

const EXT_LABEL = {
  ts: "TypeScript", tsx: "TypeScript", js: "JavaScript", jsx: "JavaScript",
  mjs: "JavaScript", cjs: "JavaScript", py: "Python", go: "Go", rb: "Ruby",
  java: "Java", kt: "Kotlin", kts: "Kotlin", rs: "Rust", vue: "Vue",
  svelte: "Svelte", c: "C", h: "C", cpp: "C++", hpp: "C++", cs: "C#",
  php: "PHP", swift: "Swift", m: "Objective-C", scala: "Scala", dart: "Dart",
};

const MAX_FOLDER_NODES = 140;
const MAX_FILE_NODES = 220;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min sessionStorage cache per repo
const CHURN_FOLDER_CAP = 12; // hard cap on extra API calls for churn analysis

// ---------- DOM ----------

const $ = (id) => document.getElementById(id);
const hero = $("hero"), stage = $("stage"), loading = $("loadingState"), errorEl = $("errorState");
const form = $("repoForm"), input = $("repoInput");
const graphContainer = $("graphContainer"), mermaidTarget = $("mermaidTarget");
const statsEl = $("stats");
const modeFolders = $("modeFolders"), modeFiles = $("modeFiles");
const tokenInput = $("tokenInput");
const heatmapToggle = $("heatmapToggle"), heatmapMetric = $("heatmapMetric");
const heatmapLegend = $("heatmapLegend"), churnBtn = $("churnBtn");

let lastTreeData = null;   // { owner, repo, files:[{path,size}], truncated }
let currentMode = "folders";
let heatScores = null;     // path -> { score, totalBytes, fileCount, childCount }
let churnScores = new Map(); // path -> recency score (0..1), merged on top of heatScores
let heatmapWorker = null;
let heatmapRequestId = 0;

// ---------- heatmap worker ----------

function getWorker() {
  if (!heatmapWorker) {
    heatmapWorker = new Worker("heatmap.worker.js");
  }
  return heatmapWorker;
}

function computeHeatScores(files, mode) {
  return new Promise((resolve) => {
    const worker = getWorker();
    const requestId = ++heatmapRequestId;

    const handler = (e) => {
      if (e.data.requestId !== undefined && e.data.requestId !== requestId) return;
      worker.removeEventListener("message", handler);
      resolve(e.data.scores);
    };
    worker.addEventListener("message", handler);
    worker.postMessage({
      requestId,
      mode,
      files: files.map((f) => ({ path: f.path, size: f.size })),
    });
  });
}

// ---------- color scale ----------

function lerp(a, b, t) { return Math.round(a + (b - a) * t); }

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function colorForScore(score) {
  const cool = hexToRgb("#4ade80");   // green — small / peripheral
  const mid = hexToRgb("#f5a86b");    // amber — mid
  const hot = hexToRgb("#fb7185");    // red — large / central

  const [c1, c2] = score <= 0.5 ? [cool, mid] : [mid, hot];
  const t = score <= 0.5 ? score / 0.5 : (score - 0.5) / 0.5;

  const r = lerp(c1[0], c2[0], t), g = lerp(c1[1], c2[1], t), b = lerp(c1[2], c2[2], t);
  return `rgb(${r},${g},${b})`;
}

function formatBytes(n) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}kB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

// ---------- token storage ----------

function getToken() { return localStorage.getItem("mirror_gh_token") || ""; }
$("tokenSave").addEventListener("click", () => {
  const v = tokenInput.value.trim();
  if (v) localStorage.setItem("mirror_gh_token", v);
  tokenInput.value = "";
  tokenInput.placeholder = v ? "Saved ✓" : "ghp_...";
});
$("tokenClear").addEventListener("click", () => {
  localStorage.removeItem("mirror_gh_token");
  tokenInput.placeholder = "Cleared";
});
$("footerTokenLink").addEventListener("click", (e) => {
  e.preventDefault();
  document.querySelector(".token-box").open = true;
  document.querySelector(".token-box").scrollIntoView({ behavior: "smooth", block: "center" });
});

// ---------- parsing input ----------

function parseRepoInput(raw) {
  let s = raw.trim();
  s = s.replace(/^https?:\/\//, "").replace(/^github\.com\//, "");
  s = s.replace(/\.git$/, "").replace(/\/$/, "");
  const parts = s.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  return { owner: parts[0], repo: parts[1] };
}

// ---------- states ----------

function showState(name) {
  hero.hidden = name !== "hero";
  stage.hidden = name !== "stage";
  loading.hidden = name !== "loading";
  errorEl.hidden = name !== "error";
}

function showError(msg) {
  $("errorText").textContent = msg;
  showState("error");
}

// ---------- github api (with sessionStorage cache) ----------

async function ghFetch(url) {
  const headers = { Accept: "application/vnd.github+json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    if (res.status === 404) throw new Error("Repository not found — check the spelling, or it might be private.");
    if (res.status === 403) {
      const remaining = res.headers.get("x-ratelimit-remaining");
      if (remaining === "0") {
        throw new Error("GitHub rate limit reached. Add a personal access token below to raise the limit to 5,000/hour.");
      }
      throw new Error("Access forbidden — this may be a private repository.");
    }
    throw new Error(`GitHub API error (${res.status}).`);
  }
  return res.json();
}

function cacheKey(owner, repo) { return `mirror_cache_${owner}/${repo}`; }

function readCache(owner, repo) {
  try {
    const raw = sessionStorage.getItem(cacheKey(owner, repo));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.ts > CACHE_TTL_MS) return null;
    return parsed;
  } catch { return null; }
}

function writeCache(owner, repo, data) {
  try {
    sessionStorage.setItem(cacheKey(owner, repo), JSON.stringify({ ...data, ts: Date.now() }));
  } catch { /* storage full or unavailable — non-fatal, just skip caching */ }
}

async function fetchRepoTree(owner, repo) {
  const cached = readCache(owner, repo);
  if (cached) return cached;

  const meta = await ghFetch(`https://api.github.com/repos/${owner}/${repo}`);
  const branch = meta.default_branch;
  const tree = await ghFetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`
  );
  const result = { meta, tree: tree.tree || [], truncated: !!tree.truncated, branch };
  writeCache(owner, repo, result);
  return result;
}

// ---------- graph building ----------

function sanitize(name) {
  return "n_" + name.replace(/[^a-zA-Z0-9]/g, "_");
}

function buildGraph(files, mode) {
  const folderNodes = new Map();     // id -> label
  const folderPathById = new Map();  // id -> full folder path (matches heatmap worker keys)
  const edges = new Set();
  const fileLeafEdges = new Set();
  const fileLeafNodes = new Map();   // id -> { label, size }

  let folderCount = 0, fileCount = 0, truncatedFolders = false, truncatedFiles = false;

  files.forEach((f) => {
    const parts = f.path.split("/");
    const fileName = parts.pop();
    let parentId = null;
    let parentPath = "";

    for (const part of parts) {
      const fullPath = (parentPath ? parentPath + "/" : "") + part;
      const nodeId = sanitize(fullPath);
      parentPath = fullPath;

      if (!folderNodes.has(nodeId)) {
        if (folderNodes.size >= MAX_FOLDER_NODES) { truncatedFolders = true; }
        else {
          folderNodes.set(nodeId, part);
          folderPathById.set(nodeId, fullPath);
          folderCount++;
        }
      }

      if (parentId && folderNodes.has(nodeId) && folderNodes.has(parentId)) {
        edges.add(`${parentId} --> ${nodeId}`);
      }
      parentId = nodeId;
    }

    if (mode === "files" && parentId) {
      fileCount++;
      if (fileLeafNodes.size < MAX_FILE_NODES) {
        const fid = sanitize((parentPath ? parentPath + "/" : "") + fileName) + "_f";
        fileLeafNodes.set(fid, { label: fileName, size: f.size || 0 });
        fileLeafEdges.add(`${parentId} --> ${fid}`);
      } else {
        truncatedFiles = true;
      }
    } else if (mode !== "files") {
      fileCount++;
    }
  });

  return {
    folderNodes, folderPathById, fileLeafNodes, edges, fileLeafEdges,
    folderCount, fileCount, truncatedFolders, truncatedFiles,
  };
}

function renderMermaidDef(graphData, mode, heatmapOn) {
  const { folderNodes, folderPathById, fileLeafNodes, edges, fileLeafEdges } = graphData;

  const maxFileSize = Math.max(1, ...[...fileLeafNodes.values()].map((f) => f.size));
  let def = "graph LR\n";
  const styleLines = [];

  folderNodes.forEach((label, id) => {
    const path = folderPathById.get(id);
    const stat = heatmapOn && heatScores ? mergedScore(path) : null;

    if (stat) {
      const color = colorForScore(stat.score);
      const tooltip = `${path} — ${formatBytes(stat.totalBytes)}, ${stat.fileCount} files, ${stat.childCount} subfolders${stat.churn ? ", recently active" : ""}`;
      def += `${id}["<div class='hm-node' title='${escapeAttr(tooltip)}'>📁 ${escapeHtml(label)}` +
        `<span class='hm-badge' style='background:${color}33;border:1px solid ${color};color:${color}'>${formatBytes(stat.totalBytes)}</span>` +
        `</div>"]\n`;
      styleLines.push(`style ${id} stroke:${color},stroke-width:3px;`);
    } else {
      def += `${id}["📁 ${escapeHtml(label)}"]\n`;
    }
  });

  if (mode === "files") {
    fileLeafNodes.forEach((data, id) => {
      if (heatmapOn) {
        const score = maxFileSize > 0 ? data.size / maxFileSize : 0;
        const color = colorForScore(score);
        def += `${id}("<div class='hm-node' title='${escapeAttr(formatBytes(data.size))}'>📄 ${escapeHtml(data.label)}` +
          `<span class='hm-badge' style='background:${color}33;border:1px solid ${color};color:${color}'>${formatBytes(data.size)}</span>` +
          `</div>")\n`;
      } else {
        def += `${id}("📄 ${escapeHtml(data.label)}")\n`;
      }
    });
  }

  edges.forEach((e) => { def += e + "\n"; });
  if (mode === "files") { fileLeafEdges.forEach((e) => { def += e + "\n"; }); }
  styleLines.forEach((s) => { def += s + "\n"; });

  return def;
}

function mergedScore(path) {
  const base = heatScores ? heatScores[path] : null;
  if (!base) return null;
  if (churnScores.has(path)) {
    const churn = churnScores.get(path);
    return { ...base, score: base.score * 0.5 + churn * 0.5, churn: true };
  }
  return base;
}

function escapeHtml(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function escapeAttr(s) { return s.replace(/&/g, "&amp;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

function computeLangStats(files) {
  const counts = {};
  files.forEach((f) => {
    const ext = f.path.split(".").pop().toLowerCase();
    const label = EXT_LABEL[ext];
    if (label) counts[label] = (counts[label] || 0) + 1;
  });
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([lang, n]) => ({ lang, pct: Math.round((n / total) * 100) }));
}

// ---------- render ----------

async function renderGraph(mode) {
  if (!lastTreeData) return;
  const heatmapOn = heatmapToggle.checked;
  heatmapLegend.classList.toggle("hidden", !heatmapOn);

  if (heatmapOn && !heatScores) {
    heatScores = await computeHeatScores(lastTreeData.files, heatmapMetric.value);
  }

  const graphData = buildGraph(lastTreeData.files, mode);
  const def = renderMermaidDef(graphData, mode, heatmapOn);
  const { folderCount, fileCount, truncatedFolders, truncatedFiles } = graphData;

  mermaidTarget.removeAttribute("data-processed");
  mermaidTarget.innerHTML = def;
  try {
    await mermaid.run({ nodes: [mermaidTarget] });
  } catch (e) {
    graphContainer.innerHTML = `<p style="color:var(--text-dim);padding:20px;">Couldn't render this graph — the repository structure may be unusually shaped. Try "Folders" view instead.</p>`;
    return;
  }

  const langStats = computeLangStats(lastTreeData.files);
  const langHtml = langStats.map((s) => `<span class="lang-tag">${s.lang} ${s.pct}%</span>`).join(" · ");
  let note = "";
  if (truncatedFolders || truncatedFiles) note = ` <span style="color:var(--amber)">(large repo — showing top nodes)</span>`;

  statsEl.innerHTML = `
    <span><b>${folderCount}</b> folders</span>
    <span><b>${fileCount}</b> code files</span>
    <span>${langHtml || "—"}</span>
    ${note}
  `;
}

// ---------- main flow ----------

async function loadRepo(owner, repo) {
  showState("loading");
  $("loadingText").textContent = `Fetching ${owner}/${repo}…`;
  heatScores = null;
  churnScores = new Map();
  try {
    const { tree, truncated } = await fetchRepoTree(owner, repo);
    const files = tree
      .filter((n) => n.type === "blob")
      .map((n) => ({ path: n.path, size: n.size || 0 }))
      .filter((f) => {
        const ext = f.path.split(".").pop().toLowerCase();
        return CODE_EXT.has(ext);
      })
      .filter((f) => !f.path.split("/").some((seg) => IGNORED_DIRS.has(seg)));

    if (files.length === 0) {
      showError("No recognized source files found in this repository (or it uses a language MIRROR doesn't map yet).");
      return;
    }

    lastTreeData = { owner, repo, files, truncated };
    showState("stage");
    await renderGraph(currentMode);

    const url = new URL(window.location);
    url.searchParams.set("repo", `${owner}/${repo}`);
    window.history.replaceState({}, "", url);
  } catch (err) {
    showError(err.message || "Something went wrong fetching that repository.");
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const parsed = parseRepoInput(input.value);
  if (!parsed) {
    showError("That doesn't look like a GitHub repo. Try the format owner/repo or a full github.com URL.");
    return;
  }
  loadRepo(parsed.owner, parsed.repo);
});

document.querySelectorAll(".chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    const parsed = parseRepoInput(chip.dataset.repo);
    input.value = chip.dataset.repo;
    loadRepo(parsed.owner, parsed.repo);
  });
});

$("errorRetry").addEventListener("click", () => showState("hero"));

modeFolders.addEventListener("click", () => setMode("folders"));
modeFiles.addEventListener("click", () => setMode("files"));

function setMode(mode) {
  currentMode = mode;
  modeFolders.classList.toggle("active", mode === "folders");
  modeFiles.classList.toggle("active", mode === "files");
  renderGraph(mode);
}

heatmapToggle.addEventListener("change", () => renderGraph(currentMode));
heatmapMetric.addEventListener("change", () => {
  heatScores = null; // force recompute with new metric weighting
  renderGraph(currentMode);
});

churnBtn.addEventListener("click", async () => {
  if (!lastTreeData || !heatScores) return;

  const topFolders = Object.entries(heatScores)
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, CHURN_FOLDER_CAP)
    .map(([path]) => path);

  const ok = window.confirm(
    `This checks last-commit activity for the ${topFolders.length} hottest folders — ${topFolders.length} extra GitHub API request(s). Continue?`
  );
  if (!ok) return;

  churnBtn.disabled = true;
  churnBtn.textContent = "Checking activity…";

  const { owner, repo } = lastTreeData;
  const now = Date.now();

  await Promise.all(topFolders.map(async (path) => {
    try {
      const commits = await ghFetch(
        `https://api.github.com/repos/${owner}/${repo}/commits?path=${encodeURIComponent(path)}&per_page=1`
      );
      if (commits && commits[0]) {
        const daysSince = (now - new Date(commits[0].commit.author.date).getTime()) / 86400000;
        const recency = 1 - Math.min(1, Math.max(0, daysSince / 365)); // recent = hot (1), stale = cool (0)
        churnScores.set(path, recency);
      }
    } catch {
      // best-effort — skip folders that fail (rate limit, deleted path, etc.)
    }
  }));

  churnBtn.disabled = false;
  churnBtn.textContent = "+ Add churn (uses API calls)";
  await renderGraph(currentMode);
});

$("copyLinkBtn").addEventListener("click", async () => {
  await navigator.clipboard.writeText(window.location.href);
  const btn = $("copyLinkBtn");
  const original = btn.textContent;
  btn.textContent = "Copied ✓";
  setTimeout(() => (btn.textContent = original), 1600);
});

$("downloadBtn").addEventListener("click", () => {
  const svg = mermaidTarget.querySelector("svg");
  if (!svg) return;
  const serializer = new XMLSerializer();
  const source = serializer.serializeToString(svg);
  const blob = new Blob([source], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${lastTreeData ? lastTreeData.repo : "mirror"}-architecture.svg`;
  a.click();
  URL.revokeObjectURL(url);
});

// ---------- boot: auto-load from ?repo= for shared links ----------

(function boot() {
  const params = new URLSearchParams(window.location.search);
  const repoParam = params.get("repo");
  if (repoParam) {
    const parsed = parseRepoInput(repoParam);
    if (parsed) {
      input.value = repoParam;
      loadRepo(parsed.owner, parsed.repo);
      return;
    }
  }
  showState("hero");
})();
