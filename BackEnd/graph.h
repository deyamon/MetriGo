#ifndef GRAPH_H
#define GRAPH_H

#define MAX_STATIONS 300
#define MAX_EDGES 1000
#define INF 999999

// One connection between two stations
typedef struct Edge {
    int destination;
    float distance;
    struct Edge* next;
} Edge;

// The full metro graph
typedef struct {
    Edge* adjList[MAX_STATIONS];  // adjacency list
    char stationNames[MAX_STATIONS][100];
    char lineNames[MAX_STATIONS][20];
    int totalStations;
    int totalEdges;
} Graph;

// Functions
Graph* createGraph();
void addEdge(Graph* g, int src, int dest, float distance);
int loadStations(Graph* g, const char* filename);
int loadEdges(Graph* g, const char* filename);
void printGraph(Graph* g);
void freeGraph(Graph* g);

#endif