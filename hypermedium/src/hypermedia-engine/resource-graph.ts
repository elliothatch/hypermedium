import { Graph, Edge } from 'graphlib';

import * as HAL from '../hal';
import { Processor } from './processor';

export interface ExtendedResource extends HAL.Resource {
    [uri: string]: any;
}


export class ResourceGraph {
    public graph: Graph;

    constructor() {
        this.graph = new Graph();
    }

    public getResource(uri: HAL.Uri): HAL.Resource | undefined {
        const suffix = '.json';
        const node = this.graph.node(uri);
        return node && (node.resource || node.originalResource);
    }

    public addResource(uri: HAL.Uri, node: ResourceGraph.Node): void {
        this.graph.setNode(uri, node);
    }

    public addDependency(relativeUriSource: HAL.Uri, relativeUriTarget: HAL.Uri, processor: Processor): boolean {
        const edge: ResourceGraph.Edge | undefined = this.graph.edge(relativeUriSource, relativeUriTarget);
        if(!edge) {
            this.graph.setEdge(relativeUriSource, relativeUriTarget, {
                processors: [processor]
            });
            return true;
        }

        if(!edge.processors.find((p) => processor === p)) {
            edge.processors.push(processor);
            return true;
        }

        return false;
    }

    public resetDependencies(uri: HAL.Uri): void {
        const prevDependencies = this.graph.nodeEdges(uri) as Edge[];

        prevDependencies
        .filter(({v, w}) => v === uri)
        .forEach(({v, w}) => this.graph.removeEdge(v, w));
    }
}

export namespace ResourceGraph {
    export interface Node {
        /** the processed resource that will be served to the user
         * should ALWAYS be serializable. nothing fancy in the resources */
        resource?: ExtendedResource;
        /** the parsed resource before any processing has been applied */
        originalResource: ExtendedResource;
        /** true if the resource is currently being processed */
        // processing: boolean;
        /** indicates how the original resource was created */
        origin: string;
    }

    export interface Edge {
        processors: Processor[];
    }
}
