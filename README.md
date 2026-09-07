# MIRROR

Understand any GitHub repository in one look — paste a URL, get an architecture map, in your browser, in seconds.

**[Live demo →](https://spleziere-prog.github.io/mirror-dev/)**

## Why

Cloning a repo just to understand its shape is friction most people won't pay. MIRROR removes it: no install, no backend, no signup. It's a static page that talks to the GitHub API directly from your browser and renders the result client-side.

Every generated map has a shareable URL (`?repo=owner/name`) — send someone a link and they land straight on the diagram, no re-typing required. That's the whole growth loop.

## How it works

1. You give it `owner/repo` or a GitHub URL.
2. It fetches the repository's file tree via `GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1` (this endpoint is CORS-enabled, so no server is needed).
3. It builds a Mermaid graph client-side from the folder structure (optionally including files) and renders it.
4. Your browser talks only to `api.github.com`. There is no MIRROR backend — nothing about your repo is ever sent anywhere else.

Unauthenticated requests are limited to 60/hour by GitHub. The page lets you add a personal access token (public-repo read access only) to raise that to 5,000/hour; the token is stored in `localStorage` and never leaves your browser except to `api.github.com`.

## Deploying your own copy (GitHub Pages)

1. Fork or clone this repo.
2. In the repo settings, enable **Pages** → **Deploy from a branch** → branch `main`, folder `/ (root)`.
3. Your copy is live at `https://<you>.github.io/<repo>/` — `index.html`, `style.css` and `app.js` are the entire app, no build step.

## Local CLI

For deeper, offline analysis — including a **real import-dependency graph** (not just folder structure) built by parsing each file's `import`/`require` statements — there's a companion CLI:

```bash
npm install
npm run dev            # folder-structure graph (fast, works on any repo size)
npm run dev:imports    # real import-relationship graph (reads file contents locally)
```

Both write `mirror.html` to the current directory, which you can open directly in a browser.

## Supported languages

Web tool: TypeScript, JavaScript, Python, Go, Ruby, Java, Kotlin, Rust, Vue, Svelte, C/C++, C#, PHP, Swift, Objective-C, Scala, Dart (folder structure only).
CLI import-graph mode: TypeScript/JavaScript relative imports (`import`, `export ... from`, `require`).

## License

MIT
