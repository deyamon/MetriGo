#ifndef DIJKSTRA_H
#define DIJKSTRA_H

#include "graph.h"

#define MAX_ROUTE 300

typedef struct {
    int path[MAX_ROUTE];       // station IDs in order
    int pathLength;           // number of stations in path
    float totalDistance;      // total km
    int totalStops;           // number of stops
} DijkstraResult;


DijkstraResult findShortestPath(Graph* g, int source, int destination);
void printResult(Graph* g, DijkstraResult result);

#endif