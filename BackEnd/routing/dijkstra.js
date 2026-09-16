const { getMetroGraph } = require('./graph');

class MinHeap {
    constructor() {
        this.items = [];
    }

    get size() {
        return this.items.length;
    }

    push(item) {
        this.items.push(item);
        let index = this.items.length - 1;

        while (index > 0) {
            const parent = Math.floor((index - 1) / 2);
            if (this.items[parent].distance <= this.items[index].distance) break;
            [this.items[parent], this.items[index]] = [this.items[index], this.items[parent]];
            index = parent;
        }
    }

    pop() {
        if (this.items.length === 0) return null;
        if (this.items.length === 1) return this.items.pop();

        const root = this.items[0];
        this.items[0] = this.items.pop();

        let index = 0;
        while (true) {
            const left = index * 2 + 1;
            const right = left + 1;
            let smallest = index;

            if (left < this.items.length && this.items[left].distance < this.items[smallest].distance) {
                smallest = left;
            }
            if (right < this.items.length && this.items[right].distance < this.items[smallest].distance) {
                smallest = right;
            }
            if (smallest === index) break;

            [this.items[index], this.items[smallest]] = [this.items[smallest], this.items[index]];
            index = smallest;
        }

        return root;
    }
}

function findStationId(stations, name) {
    const target = String(name).toLowerCase();

    // Deliberately return the first matching station, matching the current C implementation.
    for (let id = 0; id < stations.length; id++) {
        if (stations[id] && stations[id].name.toLowerCase() === target) return id;
    }

    return -1;
}

function findShortestPath(from, to) {
    const { stations, adjacency } = getMetroGraph();
    const source = findStationId(stations, from);
    const destination = findStationId(stations, to);

    if (source === -1 || destination === -1) {
        return { success: false, message: 'Station not found' };
    }

    if (source === destination) {
        return {
            success: true,
            distance: 0,
            stops: 0,
            fare: 10,
            from: stations[source].name,
            to: stations[destination].name,
            path: [stations[source].name]
        };
    }

    const distances = Array(stations.length).fill(Infinity);
    const parents = Array(stations.length).fill(-1);
    const heap = new MinHeap();

    distances[source] = 0;
    heap.push({ node: source, distance: 0 });

    while (heap.size > 0) {
        const current = heap.pop();
        if (current.distance !== distances[current.node]) continue;
        if (current.node === destination) break;

        for (const edge of adjacency[current.node] || []) {
            const nextDistance = current.distance + edge.distance;

            if (nextDistance < distances[edge.to]) {
                distances[edge.to] = nextDistance;
                parents[edge.to] = current.node;
                heap.push({ node: edge.to, distance: nextDistance });
            }
        }
    }

    if (!Number.isFinite(distances[destination])) {
        return { success: false, message: 'No path found between these stations' };
    }

    const route = [];
    let current = destination;
    while (current !== -1) {
        route.push(current);
        current = parents[current];
    }
    route.reverse();

    const distance = Number(distances[destination].toFixed(2));
    let fare;
    if (distance <= 2) fare = 10;
    else if (distance <= 5) fare = 20;
    else if (distance <= 12) fare = 30;
    else if (distance <= 21) fare = 40;
    else if (distance <= 32) fare = 50;
    else fare = 60;

    return {
        success: true,
        distance,
        stops: route.length - 1,
        fare,
        from: stations[source].name,
        to: stations[destination].name,
        path: route.map(id => stations[id].name)
    };
}

module.exports = { findShortestPath, findStationId, MinHeap };
