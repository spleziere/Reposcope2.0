// heatmap.worker.js
// Runs off the main thread: aggregates per-folder size/centrality metrics
// from the raw file list so large repos don't jank the UI while typing/rendering.

self.onmessage = (e) => {
  const { files, mode, requestId } = e.data; // files: [{ path, size }]

  const folders = new Map(); // folderId -> { path, totalBytes, fileCount, childFolders:Set, depth }

  function ensureFolder(folderPath, depth) {
    if (!folders.has(folderPath)) {
      folders.set(folderPath, {
        path: folderPath,
        totalBytes: 0,
        fileCount: 0,
        childFolders: new Set(),
        depth,
      });
    }
    return folders.get(folderPath);
  }

  for (const file of files) {
    const parts = file.path.split("/");
    parts.pop(); // drop filename
    let acc = "";

    for (let i = 0; i < parts.length; i++) {
      const prevAcc = acc;
      acc = acc ? `${acc}/${parts[i]}` : parts[i];
      const node = ensureFolder(acc, i);

      node.totalBytes += file.size || 0;
      node.fileCount += 1;

      if (prevAcc) {
        ensureFolder(prevAcc, i - 1).childFolders.add(acc);
      }
    }
  }

  const entries = [...folders.values()];
  const maxBytes = Math.max(1, ...entries.map((f) => f.totalBytes));
  const maxChildren = Math.max(1, ...entries.map((f) => f.childFolders.size + f.fileCount));

  const scores = {};
  for (const f of entries) {
    const sizeNorm = f.totalBytes / maxBytes;
    const centralityNorm = (f.childFolders.size + f.fileCount) / maxChildren;

    let score;
    if (mode === "size") score = sizeNorm;
    else if (mode === "centrality") score = centralityNorm;
    else score = sizeNorm * 0.6 + centralityNorm * 0.4; // combined default

    scores[f.path] = {
      score: Math.min(1, score),
      totalBytes: f.totalBytes,
      fileCount: f.fileCount,
      childCount: f.childFolders.size,
    };
  }

  self.postMessage({ scores, requestId });
};
