# Week 1 Social Graph

A dependency-free GitHub Pages site for browsing the Week 1 Marvel Comics social graph.
It includes 303 character records and 1,784 directed Wikipedia links. The interactive
network map collapses these into 1,434 undirected connections: two characters are linked
when either article references the other. The character detail panel retains the original
outgoing and incoming directed-link lists.

The map can also show all 1,784 directed links. In this view, arrowheads indicate
direction and the light-to-dark green edge scale represents the target character's
undirected connection count.

The graph can be viewed as a force network or a radial degree view. The radial view
places characters on concentric degree rings, with highly connected characters near the
center and low-degree or isolated characters toward the outside.

The character directory is a horizontal, scroll-snapping carousel. Search narrows its
cards, and users can drag, swipe, scroll sideways, or use its previous/next controls to
select a character. It appears directly below the graph with compact character cards;
the selected-character detail panel sits alongside it on desktop screens. Cards show
descriptions and direct-connection counts; selecting one highlights it in the network.

The degree-distribution panel plots the observed nonzero undirected degrees on log-log
axes and compares one-parameter power-law and exponential fits. It reports their fitted
parameters and log likelihoods; isolated characters are shown separately and excluded
from the positive-degree model fits. Its degree and probability axes can each be toggled
independently between linear and logarithmic scales. A separate histogram includes all
characters and overlays a Poisson distribution fitted to the graph's mean degree.

Cluster controls create layers for the top ten characters by incoming links, outgoing
links, or undirected connections, as well as the one-hop neighborhood of the incoming
top ten. These are overlays on the complete network rather than filtered subgraphs:
all character records and links, including isolates, remain visible. Top-ten layers use
a light-to-dark color scale for rank and matching incident edges; the neighbor layer
distinguishes its incoming top-ten seeds from their neighbors.

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
