const dataPaths = {
  nodes: "data/week1_nodes.tsv",
  edges: "data/week1_edges.tsv",
};

const directory = document.querySelector("#character-directory");
const detail = document.querySelector("#character-detail");
const search = document.querySelector("#character-search");
const directoryStatus = document.querySelector("#directory-status");
const networkGraph = document.querySelector("#network-graph");
const networkStatus = document.querySelector("#network-status");
const networkLegend = document.querySelector("#network-legend");
const distributionChart = document.querySelector("#distribution-chart");
const distributionDescription = document.querySelector("#distribution-description");
const distributionXScale = document.querySelector("#distribution-x-scale");
const distributionYScale = document.querySelector("#distribution-y-scale");
const poissonChart = document.querySelector("#poisson-chart");
const layoutButtons = document.querySelectorAll(".network-layout-button");
const graphTypeButtons = document.querySelectorAll(".network-type-button");
const clusterButtons = document.querySelectorAll(".network-cluster-button");

let graph;
let selectedCharacterId;
let graphType = "undirected";
let cluster = "all";
let networkLayout = "force";

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
  const neighbors = new Map();
  const undirectedEdges = [];
  const seenConnections = new Set();

  edgeRows.forEach(([source, target]) => {
    if (!outgoing.has(source)) outgoing.set(source, []);
    if (!incoming.has(target)) incoming.set(target, []);
    outgoing.get(source).push(target);
    incoming.get(target).push(source);

    if (!neighbors.has(source)) neighbors.set(source, new Set());
    if (!neighbors.has(target)) neighbors.set(target, new Set());
    neighbors.get(source).add(target);
    neighbors.get(target).add(source);

    const [first, second] = source < target ? [source, target] : [target, source];
    const connectionId = `${first}\u0000${second}`;
    if (!seenConnections.has(connectionId)) {
      seenConnections.add(connectionId);
      undirectedEdges.push([first, second]);
    }
  });

  return { nodes, edges: edgeRows, undirectedEdges, outgoing, incoming, neighbors };
}

function displaySummary() {
  document.querySelector("#node-count").textContent = graph.nodes.size.toLocaleString();
  document.querySelector("#edge-count").textContent = graph.edges.length.toLocaleString();
  document.querySelector("#average-links").textContent = (
    graph.edges.length / graph.nodes.size
  ).toFixed(1);
}

function createSvgElement(tagName, className) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tagName);
  if (className) element.setAttribute("class", className);
  return element;
}

function createDistributionModel(degrees) {
  const frequency = new Map();
  degrees.forEach((degree) => frequency.set(degree, (frequency.get(degree) || 0) + 1));

  const minimumDegree = Math.min(...degrees);
  const maximumDegree = Math.max(...degrees);
  const meanDegree = degrees.reduce((sum, degree) => sum + degree, 0) / degrees.length;
  const support = Array.from(
    { length: maximumDegree - minimumDegree + 1 },
    (_, index) => minimumDegree + index,
  );
  const alpha =
    1 + degrees.length / degrees.reduce((sum, degree) => sum + Math.log(degree / (minimumDegree - 0.5)), 0);
  const powerWeights = support.map((degree) => degree ** -alpha);
  const powerNormalizer = powerWeights.reduce((sum, value) => sum + value, 0);
  const powerProbabilities = new Map(
    support.map((degree, index) => [degree, powerWeights[index] / powerNormalizer]),
  );

  const exponentialRate = -Math.log(
    (meanDegree - minimumDegree) / (meanDegree - minimumDegree + 1),
  );
  const exponentialWeights = support.map((degree) =>
    Math.exp(-exponentialRate * (degree - minimumDegree)),
  );
  const exponentialNormalizer = exponentialWeights.reduce((sum, value) => sum + value, 0);
  const exponentialProbabilities = new Map(
    support.map((degree, index) => [degree, exponentialWeights[index] / exponentialNormalizer]),
  );
  const logLikelihood = (probabilities) =>
    [...frequency].reduce(
      (sum, [degree, count]) => sum + count * Math.log(probabilities.get(degree)),
      0,
    );

  return {
    alpha,
    degrees,
    exponentialLogLikelihood: logLikelihood(exponentialProbabilities),
    exponentialRate,
    frequency,
    maximumDegree,
    meanDegree,
    minimumDegree,
    powerLawLogLikelihood: logLikelihood(powerProbabilities),
    powerProbabilities,
    exponentialProbabilities,
    support,
  };
}

function renderDistribution() {
  const degrees = [...graph.nodes.keys()]
    .map((id) => graph.neighbors.get(id)?.size || 0)
    .filter(Boolean);
  const model = createDistributionModel(degrees);
  const isolatedCount = graph.nodes.size - degrees.length;

  document.querySelector("#connected-node-count").textContent = degrees.length.toLocaleString();
  document.querySelector("#isolated-node-count").textContent = isolatedCount.toLocaleString();
  document.querySelector("#mean-degree").textContent = (
    model.meanDegree * degrees.length / graph.nodes.size
  ).toFixed(2);
  document.querySelector("#maximum-degree").textContent = model.maximumDegree.toLocaleString();
  document.querySelector("#power-law-fit").textContent =
    `alpha = ${model.alpha.toFixed(2)}; log likelihood = ${model.powerLawLogLikelihood.toFixed(1)}`;
  document.querySelector("#exponential-fit").textContent =
    `lambda = ${model.exponentialRate.toFixed(3)}; log likelihood = ${model.exponentialLogLikelihood.toFixed(1)}`;

  const width = 960;
  const height = 360;
  const margin = { top: 26, right: 28, bottom: 48, left: 60 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const observed = [...model.frequency].map(([degree, count]) => [degree, count / degrees.length]);
  const probabilities = [
    ...observed.map(([, probability]) => probability),
    ...model.powerProbabilities.values(),
    ...model.exponentialProbabilities.values(),
  ];
  const minimumProbability = Math.max(Math.min(...probabilities), 1 / (degrees.length * 10));
  const maximumProbability = Math.max(...probabilities);
  const isLogarithmicX = distributionXScale.value === "log";
  const isLogarithmicY = distributionYScale.value === "log";
  const x = (degree) => {
    const progress = isLogarithmicX
      ? Math.log(degree / model.minimumDegree) / Math.log(model.maximumDegree / model.minimumDegree)
      : (degree - model.minimumDegree) / (model.maximumDegree - model.minimumDegree);
    return margin.left + progress * chartWidth;
  };
  const yMaximum = isLogarithmicY ? maximumProbability : maximumProbability * 1.05;
  const y = (probability) => {
    const progress = isLogarithmicY
      ? Math.log(Math.max(probability, minimumProbability) / minimumProbability) /
        Math.log(maximumProbability / minimumProbability)
      : probability / yMaximum;
    return margin.top + (1 - progress) * chartHeight;
  };
  const path = (values) =>
    values.map(([degree, probability], index) => `${index ? "L" : "M"}${x(degree)},${y(probability)}`).join(" ");

  const axes = createSvgElement("g");
  const horizontalAxis = createSvgElement("line", "distribution-axis");
  const verticalAxis = createSvgElement("line", "distribution-axis");
  horizontalAxis.setAttribute("x1", margin.left);
  horizontalAxis.setAttribute("x2", width - margin.right);
  horizontalAxis.setAttribute("y1", height - margin.bottom);
  horizontalAxis.setAttribute("y2", height - margin.bottom);
  verticalAxis.setAttribute("x1", margin.left);
  verticalAxis.setAttribute("x2", margin.left);
  verticalAxis.setAttribute("y1", margin.top);
  verticalAxis.setAttribute("y2", height - margin.bottom);
  axes.append(horizontalAxis, verticalAxis);

  (isLogarithmicX ? [1, 2, 5, 10, 20, 50, 100] : [1, 20, 40, 60, 80, 100])
    .filter((degree) => degree >= model.minimumDegree && degree <= model.maximumDegree)
    .forEach((degree) => {
      const label = createSvgElement("text", "distribution-tick");
      label.setAttribute("x", x(degree));
      label.setAttribute("y", height - margin.bottom + 20);
      label.setAttribute("text-anchor", "middle");
      label.textContent = degree;
      axes.append(label);
    });
  (isLogarithmicY ? [0.001, 0.01, 0.1] : [0, 0.025, 0.05, 0.075, 0.1])
    .filter((probability) =>
      isLogarithmicY
        ? probability >= minimumProbability && probability <= maximumProbability
        : probability <= yMaximum,
    )
    .forEach((probability) => {
      const label = createSvgElement("text", "distribution-tick");
      label.setAttribute("x", margin.left - 9);
      label.setAttribute("y", y(probability) + 4);
      label.setAttribute("text-anchor", "end");
      label.textContent = probability.toFixed(isLogarithmicY ? 3 : 2);
      axes.append(label);
    });

  const xLabel = createSvgElement("text", "distribution-axis-label");
  xLabel.setAttribute("x", margin.left + chartWidth / 2);
  xLabel.setAttribute("y", height - 10);
  xLabel.setAttribute("text-anchor", "middle");
  xLabel.textContent = `Undirected degree (${isLogarithmicX ? "logarithmic" : "linear"} scale)`;
  const yLabel = createSvgElement("text", "distribution-axis-label");
  yLabel.setAttribute("transform", `translate(16 ${margin.top + chartHeight / 2}) rotate(-90)`);
  yLabel.setAttribute("text-anchor", "middle");
  yLabel.textContent = `Probability (${isLogarithmicY ? "logarithmic" : "linear"} scale)`;
  axes.append(xLabel, yLabel);

  const powerPath = createSvgElement("path", "distribution-power-law");
  powerPath.setAttribute(
    "d",
    path(model.support.map((degree) => [degree, model.powerProbabilities.get(degree)])),
  );
  const exponentialPath = createSvgElement("path", "distribution-exponential");
  exponentialPath.setAttribute(
    "d",
    path(model.support.map((degree) => [degree, model.exponentialProbabilities.get(degree)])),
  );
  const observedLayer = createSvgElement("g");
  observed.forEach(([degree, probability]) => {
    const point = createSvgElement("circle", "distribution-observed");
    point.setAttribute("cx", x(degree));
    point.setAttribute("cy", y(probability));
    point.setAttribute("r", "3.5");
    const title = createSvgElement("title");
    title.textContent = `Degree ${degree}: ${(probability * 100).toFixed(1)}% of connected characters`;
    point.append(title);
    observedLayer.append(point);
  });

  distributionChart.replaceChildren(axes, powerPath, exponentialPath, observedLayer);
  const scaleDescription = `${isLogarithmicX ? "Logarithmic" : "Linear"} degree axis and ${
    isLogarithmicY ? "logarithmic" : "linear"
  } probability axis`;
  distributionDescription.textContent = `${scaleDescription} for connected characters, with fitted one-parameter models.`;
  distributionChart.setAttribute(
    "aria-label",
    `${scaleDescription} comparison of the observed degree distribution with fitted power-law and exponential models.`,
  );
}

function renderPoissonDistribution() {
  const degrees = [...graph.nodes.keys()].map((id) => graph.neighbors.get(id)?.size || 0);
  const frequency = new Map();
  degrees.forEach((degree) => frequency.set(degree, (frequency.get(degree) || 0) + 1));

  const maximumDegree = Math.max(...degrees);
  const meanDegree = degrees.reduce((sum, degree) => sum + degree, 0) / degrees.length;
  const poissonCounts = [];
  let probability = Math.exp(-meanDegree);
  for (let degree = 0; degree <= maximumDegree; degree += 1) {
    poissonCounts.push(probability * degrees.length);
    probability = (probability * meanDegree) / (degree + 1);
  }

  document.querySelector("#poisson-fit").textContent =
    `Poisson mean (lambda) = ${meanDegree.toFixed(2)} across all ${degrees.length} characters`;

  const width = 960;
  const height = 300;
  const margin = { top: 24, right: 28, bottom: 48, left: 52 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const maximumCount = Math.max(...frequency.values(), ...poissonCounts) * 1.1;
  const x = (degree) => margin.left + (degree / maximumDegree) * chartWidth;
  const y = (count) => margin.top + (1 - count / maximumCount) * chartHeight;
  const barWidth = Math.max(2, chartWidth / (maximumDegree + 1) - 1);

  const axes = createSvgElement("g");
  const horizontalAxis = createSvgElement("line", "distribution-axis");
  const verticalAxis = createSvgElement("line", "distribution-axis");
  horizontalAxis.setAttribute("x1", margin.left);
  horizontalAxis.setAttribute("x2", width - margin.right);
  horizontalAxis.setAttribute("y1", height - margin.bottom);
  horizontalAxis.setAttribute("y2", height - margin.bottom);
  verticalAxis.setAttribute("x1", margin.left);
  verticalAxis.setAttribute("x2", margin.left);
  verticalAxis.setAttribute("y1", margin.top);
  verticalAxis.setAttribute("y2", height - margin.bottom);
  axes.append(horizontalAxis, verticalAxis);

  [0, 20, 40, 60, 80, 100]
    .filter((degree) => degree <= maximumDegree)
    .forEach((degree) => {
      const label = createSvgElement("text", "distribution-tick");
      label.setAttribute("x", x(degree));
      label.setAttribute("y", height - margin.bottom + 20);
      label.setAttribute("text-anchor", "middle");
      label.textContent = degree;
      axes.append(label);
    });
  [0, 10, 20, 30]
    .filter((count) => count <= maximumCount)
    .forEach((count) => {
      const label = createSvgElement("text", "distribution-tick");
      label.setAttribute("x", margin.left - 9);
      label.setAttribute("y", y(count) + 4);
      label.setAttribute("text-anchor", "end");
      label.textContent = count;
      axes.append(label);
    });

  const xLabel = createSvgElement("text", "distribution-axis-label");
  xLabel.setAttribute("x", margin.left + chartWidth / 2);
  xLabel.setAttribute("y", height - 10);
  xLabel.setAttribute("text-anchor", "middle");
  xLabel.textContent = "Undirected degree";
  const yLabel = createSvgElement("text", "distribution-axis-label");
  yLabel.setAttribute("transform", `translate(15 ${margin.top + chartHeight / 2}) rotate(-90)`);
  yLabel.setAttribute("text-anchor", "middle");
  yLabel.textContent = "Character count";
  axes.append(xLabel, yLabel);

  const bars = createSvgElement("g");
  for (let degree = 0; degree <= maximumDegree; degree += 1) {
    const count = frequency.get(degree) || 0;
    const bar = createSvgElement("rect", "poisson-bar");
    bar.setAttribute("x", x(degree) - barWidth / 2);
    bar.setAttribute("y", y(count));
    bar.setAttribute("width", barWidth);
    bar.setAttribute("height", height - margin.bottom - y(count));
    const title = createSvgElement("title");
    title.textContent = `Degree ${degree}: ${count} character${count === 1 ? "" : "s"}`;
    bar.append(title);
    bars.append(bar);
  }

  const line = createSvgElement("path", "poisson-line");
  line.setAttribute(
    "d",
    poissonCounts
      .map((count, degree) => `${degree ? "L" : "M"}${x(degree)},${y(count)}`)
      .join(" "),
  );
  poissonChart.replaceChildren(axes, bars, line);
}

function createNetworkLayout(nodes, edges) {
  const width = 960;
  const height = 600;
  const padding = 28;
  const positions = new Map(
    [...nodes.keys()].map((id, index) => {
      const angle = index * 2.399963229728653;
      const radius = Math.sqrt(index / nodes.size) * 250;
      return [
        id,
        {
          x: width / 2 + Math.cos(angle) * radius,
          y: height / 2 + Math.sin(angle) * radius,
          vx: 0,
          vy: 0,
        },
      ];
    }),
  );

  for (let iteration = 0; iteration < 280; iteration += 1) {
    const force = 1 - iteration / 280;
    const values = [...positions.values()];

    for (let left = 0; left < values.length; left += 1) {
      for (let right = left + 1; right < values.length; right += 1) {
        const a = values[left];
        const b = values[right];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.hypot(dx, dy) || 0.01;
        const repulsion = (950 / (distance * distance)) * force;
        a.vx -= (dx / distance) * repulsion;
        a.vy -= (dy / distance) * repulsion;
        b.vx += (dx / distance) * repulsion;
        b.vy += (dy / distance) * repulsion;
      }
    }

    edges.forEach(([source, target]) => {
      const a = positions.get(source);
      const b = positions.get(target);
      if (!a || !b) return;

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.hypot(dx, dy) || 1;
      const attraction = (distance - 48) * 0.012 * force;
      a.vx += (dx / distance) * attraction;
      a.vy += (dy / distance) * attraction;
      b.vx -= (dx / distance) * attraction;
      b.vy -= (dy / distance) * attraction;
    });

    values.forEach((position) => {
      position.vx += (width / 2 - position.x) * 0.0025 * force;
      position.vy += (height / 2 - position.y) * 0.0025 * force;
      position.vx *= 0.8;
      position.vy *= 0.8;
      const speed = Math.hypot(position.vx, position.vy);
      if (speed > 6) {
        position.vx = (position.vx / speed) * 6;
        position.vy = (position.vy / speed) * 6;
      }
      position.x = Math.max(padding, Math.min(width - padding, position.x + position.vx));
      position.y = Math.max(padding, Math.min(height - padding, position.y + position.vy));
    });
  }

  return positions;
}

function createRadialDegreeLayout(nodes, neighbors) {
  const width = 960;
  const height = 600;
  const centerX = width / 2;
  const centerY = height / 2;
  const maximumDegree = Math.max(...[...nodes.keys()].map((id) => neighbors.get(id)?.size || 0));
  const degreeGroups = new Map();

  nodes.forEach((character, id) => {
    const degree = neighbors.get(id)?.size || 0;
    if (!degreeGroups.has(degree)) degreeGroups.set(degree, []);
    degreeGroups.get(degree).push(character);
  });

  const positions = new Map();
  [...degreeGroups.entries()]
    .sort(([left], [right]) => left - right)
    .forEach(([degree, characters], groupIndex) => {
      const radius =
        degree === maximumDegree
          ? 34
          : 42 + Math.sqrt((maximumDegree - degree) / maximumDegree) * 230;
      characters
        .sort((left, right) => left.name.localeCompare(right.name))
        .forEach((character, index) => {
          const angle = (index / characters.length) * Math.PI * 2 + groupIndex * 0.71;
          positions.set(character.id, {
            x: centerX + Math.cos(angle) * radius,
            y: centerY + Math.sin(angle) * radius,
          });
        });
    });

  return positions;
}

function appendRadialGuides(layer) {
  const width = 960;
  const height = 600;
  const centerX = width / 2;
  const centerY = height / 2;
  const maximumDegree = Math.max(...[...graph.nodes.keys()].map((id) => graph.neighbors.get(id)?.size || 0));

  [0, Math.round(maximumDegree / 3), Math.round((maximumDegree * 2) / 3), maximumDegree].forEach(
    (degree) => {
      const radius =
        degree === maximumDegree
          ? 34
          : 42 + Math.sqrt((maximumDegree - degree) / maximumDegree) * 230;
      const circle = createSvgElement("circle", "radial-guide");
      const label = createSvgElement("text", "radial-guide-label");
      circle.setAttribute("cx", centerX);
      circle.setAttribute("cy", centerY);
      circle.setAttribute("r", radius);
      label.setAttribute("x", centerX + radius + 7);
      label.setAttribute("y", centerY + 4);
      label.textContent = `${degree} links`;
      layer.append(circle, label);
    },
  );
}

function getRankedNodeIds(getScore) {
  return [...graph.nodes.keys()].sort((left, right) => {
    const scoreDifference = getScore(right) - getScore(left);
    return scoreDifference || graph.nodes.get(left).name.localeCompare(graph.nodes.get(right).name);
  });
}

function getClusterNodeIds() {
  if (cluster === "incoming") {
    return new Set(getRankedNodeIds((id) => (graph.incoming.get(id) || []).length).slice(0, 10));
  }

  if (cluster === "outgoing") {
    return new Set(getRankedNodeIds((id) => (graph.outgoing.get(id) || []).length).slice(0, 10));
  }

  if (cluster === "degree") {
    return new Set(getRankedNodeIds((id) => graph.neighbors.get(id)?.size || 0).slice(0, 10));
  }

  if (cluster === "neighbors") {
    const topIncoming = getRankedNodeIds((id) => (graph.incoming.get(id) || []).length).slice(0, 10);
    return new Set(topIncoming.flatMap((id) => [id, ...(graph.neighbors.get(id) || [])]));
  }

  return new Set(graph.nodes.keys());
}

function interpolateColor(light, dark, progress) {
  const color = light.map((channel, index) =>
    Math.round(channel + (dark[index] - channel) * progress),
  );
  return `rgb(${color.join(" ")})`;
}

function getClusterColoring() {
  const rankings = {
    incoming: {
      label: "incoming-link rank",
      light: [147, 197, 253],
      dark: [29, 78, 216],
      color: "Blue",
      score: (id) => (graph.incoming.get(id) || []).length,
    },
    outgoing: {
      label: "outgoing-link rank",
      light: [253, 186, 116],
      dark: [194, 65, 12],
      color: "Orange",
      score: (id) => (graph.outgoing.get(id) || []).length,
    },
    degree: {
      label: "connection-count rank",
      light: [216, 180, 254],
      dark: [109, 40, 217],
      color: "Purple",
      score: (id) => graph.neighbors.get(id)?.size || 0,
    },
  };

  if (cluster === "neighbors") {
    const topIncoming = new Set(
      getRankedNodeIds((id) => (graph.incoming.get(id) || []).length).slice(0, 10),
    );
    return {
      edgeColor: "rgb(34 211 238)",
      legend: "Purple nodes are the top 10 incoming-link characters; cyan nodes are their one-hop neighbors.",
      nodeColors: new Map(
        [...getClusterNodeIds()].map((id) => [
          id,
          topIncoming.has(id) ? "rgb(124 58 237)" : "rgb(8 145 178)",
        ]),
      ),
    };
  }

  const ranking = rankings[cluster];
  if (!ranking) {
    return {
      edgeColor: undefined,
      legend: "Select a cluster filter to color its members and connecting edges.",
      nodeColors: new Map(),
    };
  }

  const rankedIds = getRankedNodeIds(ranking.score).slice(0, 10);
  const nodeColors = new Map(
    rankedIds.map((id, index) => [
      id,
      interpolateColor(ranking.light, ranking.dark, 1 - index / (rankedIds.length - 1)),
    ]),
  );
  return {
    edgeColor: interpolateColor(ranking.light, ranking.dark, 0.7),
    legend: `${ranking.color} nodes show ${ranking.label}; darker nodes rank higher and matching edges show their links.`,
    nodeColors,
  };
}

function getRenderedEdges() {
  if (graphType === "undirected") {
    return graph.undirectedEdges
      .map(([source, target]) => ({ source, target }));
  }

  const weightedEdges = graph.edges
    .map(([source, target]) => ({
      source,
      target,
      weight: graph.neighbors.get(target)?.size || 0,
    }));
  const weights = weightedEdges.map(({ weight }) => weight);
  const lowestWeight = Math.min(...weights);
  const highestWeight = Math.max(...weights);

  return weightedEdges.map((edge) => ({
    ...edge,
    color: getWeightColor(edge.weight, lowestWeight, highestWeight),
  }));
}

function getWeightColor(weight, lowestWeight, highestWeight) {
  const progress =
    highestWeight === lowestWeight ? 1 : (weight - lowestWeight) / (highestWeight - lowestWeight);
  return interpolateColor([187, 247, 208], [20, 83, 45], progress);
}

function updateGraphTypeButtons() {
  graphTypeButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.graphType === graphType));
  });
}

function updateLayoutButtons() {
  layoutButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.layout === networkLayout));
  });
}

function updateClusterButtons() {
  clusterButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.cluster === cluster));
  });
}

function selectGraphType(type) {
  graphType = type;
  renderNetwork();
}

function selectNetworkLayout(nextLayout) {
  networkLayout = nextLayout;
  renderNetwork();
}

function selectCluster(nextCluster) {
  cluster = nextCluster;
  renderNetwork();
}

function renderNetwork() {
  const positions = networkLayout === "radial" ? graph.radialPositions : graph.positions;
  const selectedConnections = graph.neighbors.get(selectedCharacterId) || new Set();
  const edges = getRenderedEdges();
  const coloring = getClusterColoring();
  const namespace = "http://www.w3.org/2000/svg";
  const definitions = document.createElementNS(namespace, "defs");
  const edgeLayer = document.createElementNS(namespace, "g");
  const nodeLayer = document.createElementNS(namespace, "g");

  if (networkLayout === "radial") appendRadialGuides(edgeLayer);

  if (graphType === "directed") {
    const marker = document.createElementNS(namespace, "marker");
    const arrow = document.createElementNS(namespace, "path");
    marker.id = "directed-arrow";
    marker.setAttribute("viewBox", "0 -3 7 6");
    marker.setAttribute("refX", "7");
    marker.setAttribute("refY", "0");
    marker.setAttribute("markerWidth", "5");
    marker.setAttribute("markerHeight", "5");
    marker.setAttribute("orient", "auto");
    arrow.setAttribute("d", "M0,-3L7,0L0,3Z");
    arrow.setAttribute("fill", "context-stroke");
    marker.append(arrow);
    definitions.append(marker);
  }

  edges.forEach(({ source, target, weight, color }) => {
    const sourcePosition = positions.get(source);
    const targetPosition = positions.get(target);
    if (!sourcePosition || !targetPosition) return;

    const edge = document.createElementNS(namespace, "line");
    const title = document.createElementNS(namespace, "title");
    edge.setAttribute("x1", sourcePosition.x);
    edge.setAttribute("y1", sourcePosition.y);
    edge.setAttribute("x2", targetPosition.x);
    edge.setAttribute("y2", targetPosition.y);
    edge.classList.add("network-edge");
    if (graphType === "directed") {
      edge.classList.add("is-weighted");
      edge.style.setProperty("--edge-color", color);
      edge.setAttribute("marker-end", "url(#directed-arrow)");
      title.textContent = `${graph.nodes.get(source).name} to ${
        graph.nodes.get(target).name
      }: target degree ${weight}`;
      edge.append(title);
    } else if (coloring.edgeColor && (coloring.nodeColors.has(source) || coloring.nodeColors.has(target))) {
      edge.classList.add("is-cluster-link");
      edge.style.setProperty("--edge-color", coloring.edgeColor);
    }
    if (source === selectedCharacterId || target === selectedCharacterId) {
      edge.classList.add("is-connected");
    }
    edgeLayer.append(edge);
  });

  graph.nodes.forEach((character, id) => {
    const position = positions.get(id);
    const node = document.createElementNS(namespace, "g");
    const circle = document.createElementNS(namespace, "circle");
    const label = document.createElementNS(namespace, "text");
    const title = document.createElementNS(namespace, "title");

    node.classList.add("network-node");
    if (coloring.nodeColors.has(id)) {
      node.style.setProperty("--node-color", coloring.nodeColors.get(id));
    }
    if (id === selectedCharacterId) node.classList.add("is-selected");
    if (selectedConnections.has(id)) node.classList.add("is-connected");
    node.setAttribute("tabindex", "0");
    node.setAttribute("role", "button");
    node.setAttribute("aria-label", `View ${character.name}'s connections`);
    node.addEventListener("click", () => selectCharacter(id));
    node.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectCharacter(id);
      }
    });

    circle.setAttribute("cx", position.x);
    circle.setAttribute("cy", position.y);
    circle.setAttribute("r", "3.5");
    label.setAttribute("x", position.x + 9);
    label.setAttribute("y", position.y + 4);
    label.textContent = character.name;
    title.textContent = character.name;
    node.append(circle, label, title);
    nodeLayer.append(node);
  });

  networkGraph.replaceChildren(definitions, edgeLayer, nodeLayer);
  updateLayoutButtons();
  updateGraphTypeButtons();
  updateClusterButtons();
  networkLegend.textContent =
    graphType === "directed" && cluster !== "all"
      ? `${coloring.legend} Directed edge green intensity still represents target connection count.`
      : coloring.legend;
  if (networkLayout === "radial") {
    networkLegend.textContent = `Radial degree view: nodes closer to the center have more undirected connections. ${networkLegend.textContent}`;
  }
  networkGraph.setAttribute(
    "aria-label",
    `${networkLayout === "radial" ? "Radial degree" : "Force-directed"} ${
      graphType === "directed" ? "directed weighted" : "undirected"
    } Marvel character network. Select a character node to inspect its connections.`,
  );
  const clusterName = {
    all: "Full network",
    incoming: "Top 10 incoming",
    outgoing: "Top 10 outgoing",
    degree: "Top 10 connections",
    neighbors: "Incoming top 10 neighbors",
  }[cluster];
  networkStatus.textContent = selectedCharacterId
    ? `${graph.nodes.get(selectedCharacterId).name}: ${selectedConnections.size.toLocaleString()} direct connection${
        selectedConnections.size === 1 ? "" : "s"
      } highlighted in the ${clusterName.toLocaleLowerCase()} ${graphType} graph.`
    : graphType === "directed"
      ? `${clusterName} layer on ${graph.nodes.size.toLocaleString()} nodes and ${edges.length.toLocaleString()} directed links. Light-to-dark green represents the target character's connection count.`
      : `${clusterName} layer on ${graph.nodes.size.toLocaleString()} nodes and ${edges.length.toLocaleString()} undirected connections. Select a node to highlight its neighbors.`;
}

function selectCharacter(id) {
  const character = graph.nodes.get(id);
  if (!character) return;

  selectedCharacterId = id;
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
  renderNetwork();
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
    graph.positions = createNetworkLayout(graph.nodes, graph.undirectedEdges);
    graph.radialPositions = createRadialDegreeLayout(graph.nodes, graph.neighbors);
    displaySummary();
    renderDistribution();
    renderPoissonDistribution();
    renderNetwork();
    renderDirectory();
    search.addEventListener("input", (event) => renderDirectory(event.target.value));
    distributionXScale.addEventListener("change", renderDistribution);
    distributionYScale.addEventListener("change", renderDistribution);
    layoutButtons.forEach((button) => {
      button.addEventListener("click", () => selectNetworkLayout(button.dataset.layout));
    });
    graphTypeButtons.forEach((button) => {
      button.addEventListener("click", () => selectGraphType(button.dataset.graphType));
    });
    clusterButtons.forEach((button) => {
      button.addEventListener("click", () => selectCluster(button.dataset.cluster));
    });
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
