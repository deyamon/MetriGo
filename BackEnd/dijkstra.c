#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "dijkstra.h"


int minDistance(float dist[], int visited[], int total) {
    float min = INF;
    int minIndex = -1;

    for (int v = 0; v < total; v++) {
        if (!visited[v] && dist[v] <= min) {
            min = dist[v];
            minIndex = v;
        }
    }
    return minIndex;
}

DijkstraResult findShortestPath(Graph* g, int source, int destination) {
    float dist[MAX_STATIONS];      
    int visited[MAX_STATIONS];     
    int parent[MAX_STATIONS];      

   
    for (int i = 0; i < MAX_STATIONS; i++) {
        dist[i] = INF;
        visited[i] = 0;
        parent[i] = -1;
    }
    dist[source] = 0;

    
    for (int count = 0; count < MAX_STATIONS - 1; count++) {

        
        int u = minDistance(dist, visited, MAX_STATIONS);
        if (u == -1) break;         
        if (u == destination) break; 

        visited[u] = 1;

        
        Edge* edge = g->adjList[u];
        while (edge != NULL) {
            int v = edge->destination;
            float weight = edge->distance;

            if (!visited[v] && dist[u] + weight < dist[v]) {
                dist[v] = dist[u] + weight;
                parent[v] = u;
            }
            edge = edge->next;
        }
    }

   
    DijkstraResult result;
    result.totalDistance = dist[destination];
    result.pathLength = 0;

    if (dist[destination] == INF) {
        
        result.pathLength = 0;
        result.totalStops = 0;
        return result;
    }

    
    int temp[MAX_ROUTE];
    int count = 0;
    int current = destination;

    while (current != -1) {
        temp[count++] = current;
        current = parent[current];
    }

    
    for (int i = 0; i < count; i++) {
        result.path[i] = temp[count - 1 - i];
    }
    result.pathLength = count;
    result.totalStops = count - 1;

    return result;
}

void printResult(Graph* g, DijkstraResult result) {
    if (result.pathLength == 0) {
        printf("\nNo path found between these stations.\n");
        return;
    }

    printf("\n==========================================\n");
    printf("         SHORTEST PATH FOUND\n");
    printf("==========================================\n\n");

    printf("PATH:\n");
    for (int i = 0; i < result.pathLength; i++) {
        int id = result.path[i];
        if (i == 0)
            printf("  [START] %s (%s Line)\n", g->stationNames[id], g->lineNames[id]);
        else if (i == result.pathLength - 1)
            printf("  [END]   %s (%s Line)\n", g->stationNames[id], g->lineNames[id]);
        else
            printf("    -->   %s (%s Line)\n", g->stationNames[id], g->lineNames[id]);
    }

    printf("\n------------------------------------------\n");
    printf("Total Stops    : %d\n", result.totalStops);
    printf("Total Distance : %.2f km\n", result.totalDistance);
    printf("------------------------------------------\n");
    printf("Algorithm      : Dijkstra's Shortest Path\n");
    printf("Time Complexity: O((V + E) log V)\n");
    printf("Space Complexity: O(V)\n");
    printf("==========================================\n");
}