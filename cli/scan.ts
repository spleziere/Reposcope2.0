import fs from "fs"
import path from "path"

const IGNORED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next",
  "coverage", ".turbo", "vendor", "target", "venv", "__pycache__",
])

const CODE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"]

export function scan(dir: string): string[] {

  const files: string[] = []

  function walk(current: string) {

    let entries: string[] = []

    try {
      entries = fs.readdirSync(current)
    } catch {
      return
    }

    for (const entry of entries) {

      const full = path.join(current, entry)

      if (IGNORED_DIRS.has(entry)) {
        continue
      }

      let stat

      try {
        stat = fs.statSync(full)
      } catch {
        continue
      }

      if (stat.isDirectory()) {
        walk(full)
      } else {
        const normalized = full.replace(/\\/g, "/")
        const isCodeFile = CODE_EXTENSIONS.some((ext) => normalized.endsWith(ext))
        if (isCodeFile) {
          files.push(normalized)
        }
      }
    }
  }

  walk(dir)

  console.log(`Scanned ${files.length} source files.`)

  return files
}

// Reads file contents for the files scan() found, keyed by normalized path.
// Used by the --imports mode to build a real import graph instead of just folders.
export function readContents(files: string[]): Map<string, string> {

  const contents = new Map<string, string>()

  for (const file of files) {
    try {
      contents.set(file, fs.readFileSync(file, "utf8"))
    } catch {
      // unreadable file (binary, permissions, etc.) — skip silently
    }
  }

  return contents
}
