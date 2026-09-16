const fs = require('fs');
const path = require('path');

function parseStations(filePath) {
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    const stations = [];

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const parts = line.split(',');
        if (parts.length < 2 || !parts[1].trim()) continue;

        const id = Number(parts[0].trim());
        if (!Number.isInteger(id)) continue;

        stations[id] = {
            id,
            name: parts[1].trim(),
            line: parts[2] ? parts[2].trim() : ''
        };
    }

    return stations;
}

function parseEdges(filePath) {
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    const edges = [];

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const parts = line.split(',');
        if (parts.length < 3) continue;

        const from = Number(parts[0].trim());
        const to = Number(parts[1].trim());
        const distance = Number(parts[2].trim());

        if (Number.isInteger(from) && Number.isInteger(to) && Number.isFinite(distance)) {
            edges.push({ from, to, distance });
        }
    }

    return edges;
}

function buildGraph(stations, edges) {
    const adjacency = stations.map(() => []);

    for (const edge of edges) {
        if (!stations[edge.from] || !stations[edge.to]) continue;

        // The C implementation treats the metro network as undirected.
        adjacency[edge.from].push({ to: edge.to, distance: edge.distance });
        adjacency[edge.to].push({ to: edge.from, distance: edge.distance });
    }

    return adjacency;
}

function loadMetroGraph() {
    const dataDir = path.join(__dirname, '..', 'data');
    const stations = parseStations(path.join(dataDir, 'stations.csv'));
    const edges = parseEdges(path.join(dataDir, 'edges.csv'));
    const adjacency = buildGraph(stations, edges);

    return { stations, edges, adjacency };
}

let cachedGraph = null;

function getMetroGraph() {
    if (!cachedGraph) cachedGraph = loadMetroGraph();
    return cachedGraph;
}

module.exports = {
    getMetroGraph,
    loadMetroGraph,
    parseStations,
    parseEdges,
    buildGraph
};
