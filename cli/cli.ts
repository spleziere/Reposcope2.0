#!/usr/bin/env node

import fs from "fs"
import path from "path"

import { scan, readContents } from "./scan"
import { createGraph, createImportGraph } from "./graph"
import { generateHTML } from "./html"

const args = process.argv.slice(2)
const useImports = args.includes("--imports")
const targetArg = args.find((a) => !a.startsWith("--"))

const target = targetArg ? path.resolve(targetArg) : process.cwd()

if (!fs.existsSync(target)) {
  console.error(`Path not found: ${target}`)
  process.exit(1)
}

console.log(`Scanning ${target}${useImports ? " (import graph mode)" : " (folder graph mode)"}...`)

const files = scan(target)

if (files.length === 0) {
  console.error("No .ts/.tsx/.js/.jsx files found. Nothing to visualize.")
  process.exit(1)
}

const graph = useImports
  ? createImportGraph(files, readContents(files))
  : createGraph(files)

const html = generateHTML(graph, path.basename(target))

const outFile = "mirror.html"
fs.writeFileSync(outFile, html)

console.log(`MIRROR generated: ${outFile}`)
if (!useImports) {
  console.log("Tip: run with --imports for a real import-dependency graph instead of just folders.")
}
