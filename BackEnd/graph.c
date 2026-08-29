#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "graph.h"


Graph* createGraph() {
    Graph* g = (Graph*)malloc(sizeof(Graph));
    for (int i = 0; i < MAX_STATIONS; i++) {
        g->adjList[i] = NULL;
        g->stationNames[i][0] = '\0';
        g->lineNames[i][0] = '\0';
    }
    g->totalStations = 0;
    g->totalEdges = 0;
    return g;
}


void addEdge(Graph* g, int src, int dest, float distance) {
    // src -> dest
    Edge* newEdge = (Edge*)malloc(sizeof(Edge));
    newEdge->destination = dest;
    newEdge->distance = distance;
    newEdge->next = g->adjList[src];
    g->adjList[src] = newEdge;

    // dest -> src
    Edge* reverseEdge = (Edge*)malloc(sizeof(Edge));
    reverseEdge->destination = src;
    reverseEdge->distance = distance;
    reverseEdge->next = g->adjList[dest];
    g->adjList[dest] = reverseEdge;

    g->totalEdges++;
}

// Read stations.csv and fill stationNames[]
int loadStations(Graph* g, const char* filename) {
    FILE* file = fopen(filename, "r");
    if (!file) {
        printf("ERROR: Cannot open %s\n", filename);
        return -1;
    }

    char line[200];
    fgets(line, sizeof(line), file); 

    int id;
    char name[100];
    char lineName[20];

    while (fgets(line, sizeof(line), file)) {
       
        char* token = strtok(line, ",");
        id = atoi(token);

        token = strtok(NULL, ",");
        strcpy(name, token);

        token = strtok(NULL, ",\n");
        strcpy(lineName, token);

        strcpy(g->stationNames[id], name);
        strcpy(g->lineNames[id], lineName);
        g->totalStations++;
    }

    fclose(file);
    printf("Loaded %d stations.\n", g->totalStations);
    return 0;
}


int loadEdges(Graph* g, const char* filename) {
    FILE* file = fopen(filename, "r");
    if (!file) {
        printf("ERROR: Cannot open %s\n", filename);
        return -1;
    }

    char line[200];
    fgets(line, sizeof(line), file); // skip header row

    int src, dest;
    float dist;

    while (fgets(line, sizeof(line), file)) {
       
        char* token = strtok(line, ",");
        src = atoi(token);

        token = strtok(NULL, ",");
        dest = atoi(token);

        token = strtok(NULL, ",\n");
        dist = atof(token);

        addEdge(g, src, dest, dist);
    }

    fclose(file);
    printf("Loaded %d edges.\n", g->totalEdges);
    return 0;
}


void printGraph(Graph* g) {
    printf("\n=== METRO GRAPH ===\n");
    for (int i = 0; i < MAX_STATIONS; i++) {
        if (g->stationNames[i][0] == '\0') continue;
        printf("[%d] %s (%s) --> ", i, g->stationNames[i], g->lineNames[i]);
        Edge* temp = g->adjList[i];
        while (temp) {
            printf("%s(%.1fkm) ", g->stationNames[temp->destination], temp->distance);
            temp = temp->next;
        }
        printf("\n");
    }
}


void freeGraph(Graph* g) {
    for (int i = 0; i < MAX_STATIONS; i++) {
        Edge* curr = g->adjList[i];
        while (curr) {
            Edge* next = curr->next;
            free(curr);
            curr = next;
        }
    }
    free(g);
}