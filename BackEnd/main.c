#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "graph.h"
#include "dijkstra.h"


// FARE CALCULATOR

int calculateFare(float distance) {
    if (distance <= 2)        return 10;
    else if (distance <= 5)   return 20;
    else if (distance <= 12)  return 30;
    else if (distance <= 21)  return 40;
    else if (distance <= 32)  return 50;
    else                      return 60;
}



int findStationByName(Graph* g, const char* name) {
    for (int i = 0; i < MAX_STATIONS; i++) {
        if (g->stationNames[i][0] == '\0') continue;

        char a[100], b[100];
        strcpy(a, g->stationNames[i]);
        strcpy(b, name);

        for (int j = 0; a[j]; j++) if (a[j] >= 'A' && a[j] <= 'Z') a[j] += 32;
        for (int j = 0; b[j]; j++) if (b[j] >= 'A' && b[j] <= 'Z') b[j] += 32;

        if (strcmp(a, b) == 0) return i;
    }
    return -1;
}


void listAllStations(Graph* g) {
    printf("\n==========================================\n");
    printf("         AVAILABLE STATIONS\n");
    printf("==========================================\n");
    printf("  %-5s %-30s %s\n", "ID", "Station Name", "Line");
    printf("------------------------------------------\n");

    char currentLine[20] = "";
    for (int i = 0; i < MAX_STATIONS; i++) {
        if (g->stationNames[i][0] == '\0') continue;
        if (strcmp(currentLine, g->lineNames[i]) != 0) {
            strcpy(currentLine, g->lineNames[i]);
            printf("\n  --- %s Line ---\n", currentLine);
        }
        printf("  %-5d %-30s %s\n", i, g->stationNames[i], g->lineNames[i]);
    }
    printf("==========================================\n\n");
}


int main(int argc, char* argv[]) {

    Graph* g = createGraph();
    loadStations(g, "data/stations.csv");
    loadEdges(g, "data/edges.csv");

    
    if (argc == 3) {
        int src  = findStationByName(g, argv[1]);
        int dest = findStationByName(g, argv[2]);

        if (src == -1 || dest == -1) {
            printf("{\"success\":false,\"message\":\"Station not found\"}");
            freeGraph(g);
            return 1;
        }

        DijkstraResult result = findShortestPath(g, src, dest);
        int fare = calculateFare(result.totalDistance);

        printf("{");
        printf("\"success\":true,");
        printf("\"distance\":%.2f,", result.totalDistance);
        printf("\"stops\":%d,", result.totalStops);
        printf("\"fare\":%d,", fare);
        printf("\"from\":\"%s\",", g->stationNames[src]);
        printf("\"to\":\"%s\",", g->stationNames[dest]);
        printf("\"path\":[");
        for (int i = 0; i < result.pathLength; i++) {
            printf("\"%s\"", g->stationNames[result.path[i]]);
            if (i < result.pathLength - 1) printf(",");
        }
        printf("]}");

        freeGraph(g);
        return 0;
    }

   
    printf("\n==========================================\n");
    printf("      DELHI METRO TICKETING SYSTEM\n");
    printf("    DAA Project | Dijkstra's Algorithm\n");
    printf("==========================================\n\n");
    printf("Metro network loaded!\n");

    int choice;
    while (1) {
        printf("\n==========================================\n");
        printf("                MAIN MENU\n");
        printf("==========================================\n");
        printf("  1. Find Shortest Path\n");
        printf("  2. List All Stations\n");
        printf("  3. Exit\n");
        printf("Enter choice: ");
        scanf("%d", &choice);
        getchar();

        switch (choice) {
            case 1: {
                char fromName[100], toName[100];

                printf("\nEnter SOURCE station: ");
                fgets(fromName, sizeof(fromName), stdin);
                fromName[strcspn(fromName, "\n")] = '\0';

                printf("Enter DESTINATION station: ");
                fgets(toName, sizeof(toName), stdin);
                toName[strcspn(toName, "\n")] = '\0';

                int src  = findStationByName(g, fromName);
                int dest = findStationByName(g, toName);

                if (src == -1) { printf("\nStation '%s' not found.\n", fromName); break; }
                if (dest == -1) { printf("\nStation '%s' not found.\n", toName); break; }
                if (src == dest) { printf("\nSame station!\n"); break; }

                DijkstraResult result = findShortestPath(g, src, dest);
                printResult(g, result);

                if (result.pathLength > 0) {
                    int fare = calculateFare(result.totalDistance);
                    printf("\n  FARE: Rs. %d\n", fare);
                }
                break;
            }
            case 2:
                listAllStations(g);
                break;

            case 3:
                printf("\nGoodbye!\n");
                freeGraph(g);
                return 0;

            default:
                printf("\nInvalid choice.\n");
        }
    }
}