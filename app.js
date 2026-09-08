const dataPaths = {
  nodes: "data/week1_nodes.tsv",
  edges: "data/week1_edges.tsv",
};

const directory = document.querySelector("#character-directory");
const detail = document.querySelector("#character-detail");
const search = document.querySelector("#character-search");
const directoryStatus = document.querySelector("#directory-status");

let graph;

function parseTsv(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split("\t"));
}

function createElement(tagName, text, className) {
  const element = document.createElement(tagName);
  if (text) {
    element.textContent = text;
  }
  if (className) {
    element.className = className;
  }
  return element;
}

async function loadGraph() {
  const [nodeResponse, edgeResponse] = await Promise.all([
    fetch(dataPaths.nodes),
    fetch(dataPaths.edges),
  ]);

  if (!nodeResponse.ok || !edgeResponse.ok) {
    throw new Error("The graph data could not be loaded.");
  }

  const nodeRows = parseTsv(await nodeResponse.text());
  const edgeRows = parseTsv(await edgeResponse.text());
  const [, ...nodeData] = nodeRows;
  const nodes = new Map(
    nodeData.map(([id, name, wikidataId, url, description]) => [
      id,
      { id, name, wikidataId, url, description },
    ]),
  );
  const outgoing = new Map();
  const incoming = new Map();

  edgeRows.forEach(([source, target]) => {
    if (!outgoing.has(source)) outgoing.set(source, []);
    if (!incoming.has(target)) incoming.set(target, []);
    outgoing.get(source).push(target);
    incoming.get(target).push(source);
  });

  return { nodes, edges: edgeRows, outgoing, incoming };
}

function displaySummary() {
  document.querySelector("#node-count").textContent = graph.nodes.size.toLocaleString();
  document.querySelector("#edge-count").textContent = graph.edges.length.toLocaleString();
  document.querySelector("#average-links").textContent = (
    graph.edges.length / graph.nodes.size
  ).toFixed(1);
}

function selectCharacter(id) {
  const character = graph.nodes.get(id);
  if (!character) return;

  detail.replaceChildren();
  detail.append(createElement("p", "Connections", "eyebrow"));
  detail.append(createElement("h2", character.name));
  detail.append(createElement("p", character.description, "detail-description"));

  const wikipediaLink = createElement("a", "Read on Wikipedia", "detail-link");
  wikipediaLink.href = character.url;
  wikipediaLink.target = "_blank";
  wikipediaLink.rel = "noreferrer";
  detail.append(wikipediaLink);

  const connectionGrid = createElement("div", "", "connection-grid");
  connectionGrid.append(
    createConnectionColumn("Links to", graph.outgoing.get(id) || []),
    createConnectionColumn("Linked from", graph.incoming.get(id) || []),
  );
  detail.append(connectionGrid);

  document.querySelectorAll(".character-button").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.id === id));
  });
}

function createConnectionColumn(title, ids) {
  const column = createElement("section");
  const heading = createElement(
    "h3",
    `${title} (${ids.length.toLocaleString()})`,
    "connection-heading",
  );
  column.append(heading);

  if (!ids.length) {
    column.append(createElement("p", "None in this dataset.", "empty-state"));
    return column;
  }

  const list = createElement("div", "", "connection-list");
  ids
    .map((id) => graph.nodes.get(id))
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((character) => {
      const button = createElement("button", character.name, "connection-button");
      button.type = "button";
      button.addEventListener("click", () => selectCharacter(character.id));
      list.append(button);
    });
  column.append(list);
  return column;
}

function renderDirectory(query = "") {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const characters = [...graph.nodes.values()].filter((character) => {
    const searchableText = `${character.name} ${character.description} ${character.id}`;
    return searchableText.toLocaleLowerCase().includes(normalizedQuery);
  });

  directory.replaceChildren();
  directoryStatus.textContent = `${characters.length.toLocaleString()} character${
    characters.length === 1 ? "" : "s"
  } found`;

  if (!characters.length) {
    directory.append(createElement("p", "No characters match that search.", "empty-state"));
    return;
  }

  characters
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((character) => {
      const button = createElement("button", "", "character-button");
      button.type = "button";
      button.dataset.id = character.id;
      button.setAttribute("aria-pressed", "false");
      button.append(
        createElement("strong", character.name),
        createElement("span", character.description),
      );
      button.addEventListener("click", () => selectCharacter(character.id));
      directory.append(button);
    });
}

async function initialize() {
  try {
    graph = await loadGraph();
    displaySummary();
    renderDirectory();
    search.addEventListener("input", (event) => renderDirectory(event.target.value));
  } catch (error) {
    directoryStatus.textContent = "Unable to load the graph data.";
    detail.replaceChildren(
      createElement(
        "p",
        "Serve this folder through a web server so the TSV files can be loaded.",
        "empty-state",
      ),
    );
    console.error(error);
  }
}

initialize();
