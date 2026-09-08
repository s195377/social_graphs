# Week 1 Social Graph

A dependency-free GitHub Pages site for browsing the Week 1 Marvel Comics social graph.
It includes 303 character records and 1,784 directed Wikipedia links. A directed edge
`A -> B` means that the Wikipedia article for character A links to the article for
character B.

The source TSV files are stored in [`data/`](data/) and originate from the
[Social Graphs 2026 data page](https://sunelehmann.com/socialgraphs2026-web/data/).

## Run locally

Browsers prevent `fetch` from loading the TSV files from a `file://` URL. From this
directory, serve the site with an existing local HTTP server, for example:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Publish with GitHub Pages

1. Create a GitHub repository from this directory and push its default branch.
2. In the repository, open **Settings** > **Pages**.
3. Under **Build and deployment**, select **Deploy from a branch**, choose the default
   branch, and set the folder to **/(root)**.
4. Save the settings. GitHub will provide the published URL after deployment completes.

No build command is required: GitHub Pages serves `index.html` and the local TSV assets
directly.
