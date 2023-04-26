import { Graph, Edge } from 'graphlib';

import * as HAL from '../hal';
import { normalizeUri } from '../hal-util';
import { Processor } from './processor';

export class ResourceGraph {
    public graph: Graph;

    constructor() {
        this.graph = new Graph();
    }

    public getResource(uri: HAL.Uri): HAL.Resource | undefined {
        const suffix = '.json';
        if(uri.slice(-1) === '/') {
            const node = this.graph.node(normalizeUri(uri) || this.graph.node(uri));
            // returns undefined if we get a file node, because it doesn't have a resource/originalResource property
            return node && (node.resource || node.originalResource);
        }
        else if(uri.lastIndexOf('.') < uri.lastIndexOf('/')) {
            // no file extension, try to find a file with the default suffix
            // TODO: store a set of "suffixes", pick based on Accept header, or use default 'suffix' if missing
            // TODO: default suffix should be inherited from all the modules' resourceExtension
            const node = this.graph.node(`${uri}${suffix}`) || this.graph.node(uri) || this.graph.node(normalizeUri(uri + '/'));
            return node && (node.resource || node.originalResource);

        }
        const node = this.graph.node(uri);
        return node && (node.resource || node.originalResource);
    }

    public addResource(uri: HAL.Uri, node: ResourceGraph.Node): void {
        this.graph.setNode(uri, node);
    }

    public getFile(uri: HAL.Uri): string | undefined {
        const node = this.graph.node(normalizeUri(uri) || this.graph.node(uri));
        return node && node.path;
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
    export type Node = Node.Resource | Node.File;
    export namespace Node {
        export interface Resource {
            eType: 'resource';
            /** the processed resource that will be served to the user
             * should ALWAYS be serializable. nothing fancy in the resources */
            resource?: HAL.ExtendedResource;
            /** the parsed resource before any processing has been applied */
            originalResource: HAL.ExtendedResource;
            /** true if the resource is currently being processed */
            // processing: boolean;
            /** indicates how the original resource was created */
            origin: string;
        }
        export interface File {
            eType: 'file';
            path: string;
        }
    }

    export interface Edge {
        processors: Processor[];
    }
}
