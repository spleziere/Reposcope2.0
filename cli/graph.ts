import path from "path"

// ---------- folder-structure graph (original behavior) ----------

export function createGraph(files: string[]) {

  let graph = `\ngraph LR\n`

  const relations = new Set<string>()
  const nodes = new Set<string>()

  files.forEach((file) => {

    const normalized = file.replace(/\\/g, "/")
    const srcIndex = normalized.indexOf("/src/")

    if (srcIndex === -1) {
      return
    }

    const relative = normalized.slice(srcIndex + 1)
    const parts = relative.split("/")
    parts.pop() // remove filename

    for (let i = 0; i < parts.length - 1; i++) {

      const parent = sanitize(parts[i])
      const child = sanitize(parts[i + 1])

      if (parent && child && parent !== child) {
        nodes.add(parent)
        nodes.add(child)
        relations.add(`${parent} --> ${child}`)
      }
    }
  })

  nodes.forEach((node) => { graph += `\n${node}["📁 ${node}"]\n` })
  relations.forEach((relation) => { graph += `\n${relation}\n` })

  return graph
}

// ---------- import-relationship graph (new) ----------
// Parses relative import/require statements out of each file and draws a
// real dependency graph between files, instead of just the folder tree.

const IMPORT_PATTERNS = [
  /import\s+(?:[\s\S]*?\sfrom\s+)?['"](\.[^'"]+)['"]/g,
  /export\s+(?:[\s\S]*?\sfrom\s+)?['"](\.[^'"]+)['"]/g,
  /require\(\s*['"](\.[^'"]+)['"]\s*\)/g,
]

const RESOLVE_EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"]

export function createImportGraph(files: string[], contents: Map<string, string>, maxNodes = 150) {

  const fileSet = new Set(files.map((f) => f.replace(/\\/g, "/")))
  const edges = new Set<string>()
  const nodes = new Set<string>()
  let truncated = false

  for (const file of files) {

    const normalized = file.replace(/\\/g, "/")
    const source = contents.get(file)
    if (!source) continue

    const dir = path.dirname(normalized)
    const targets = new Set<string>()

    for (const pattern of IMPORT_PATTERNS) {
      pattern.lastIndex = 0
      let match
      while ((match = pattern.exec(source)) !== null) {
        const resolved = resolveImport(dir, match[1], fileSet)
        if (resolved) targets.add(resolved)
      }
    }

    if (targets.size === 0) continue

    if (nodes.size >= maxNodes) { truncated = true; break }

    const fromId = sanitize(shortLabel(normalized))
    nodes.add(fromId)

    targets.forEach((t) => {
      if (nodes.size >= maxNodes) { truncated = true; return }
      const toId = sanitize(shortLabel(t))
      nodes.add(toId)
      edges.add(`${fromId} --> ${toId}`)
    })
  }

  let graph = `\ngraph LR\n`
  nodes.forEach((id) => { graph += `\n${id}["📄 ${idToLabel.get(id) ?? id}"]\n` })
  edges.forEach((e) => { graph += `\n${e}\n` })

  if (truncated) {
    graph += `\n%% Note: graph truncated at ${maxNodes} nodes for readability\n`
  }

  return graph
}

const idToLabel = new Map<string, string>()

function shortLabel(filePath: string): string {
  const parts = filePath.split("/")
  return parts.slice(-2).join("/")
}

function resolveImport(fromDir: string, importPath: string, fileSet: Set<string>): string | null {

  const base = path.join(fromDir, importPath).replace(/\\/g, "/")

  for (const ext of RESOLVE_EXTENSIONS) {
    const candidate = base + ext
    if (fileSet.has(candidate)) return candidate
  }

  return null
}

function sanitize(name: string) {
  const id = "n_" + name.replace(/[^a-zA-Z0-9]/g, "_")
  idToLabel.set(id, name)
  return id
}
