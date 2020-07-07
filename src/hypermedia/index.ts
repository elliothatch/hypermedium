import * as Path from 'path';
import { promises as fs } from 'fs';
import * as Url from 'url';
import { hrtime } from 'process';

import { Observable, Observer } from 'rxjs';

import { NextFunction, Router, Request, Response } from 'express';
import { Graph, Edge } from 'graphlib';

import * as HAL from '../hal';
import { filterCuries, profilesMatch, resourceMatchesProfile, getProfiles } from '../hal-util';
import { createSchema, walkDirectory, objectDifference } from '../util';

import { Processor } from './processor';
export * from './processor';

/** augments a hypermedia site with dynamic properties and resources
 * for example, adds "self" links and "breadcrumb"
 * dynamic resources like comments can be updated with CRUD actions through hypermedia
 * dynamic tagging
 * use middleware to extend resources that match a certain profile
 */
export class Hypermedia {
    public router: Router;
    public state: Hypermedia.State;
    public processors: Processor[];
    /** maps relative uri to the original resource loaded from the file system */
    public files: {[uri: string]: string};

    /** each loaded resource is stored in the graph, and dependencies between resources are tracked here */
    public resourceGraph: Graph;

    public event$: Observable<Hypermedia.Event>;
    protected eventObserver!: Observer<Hypermedia.Event>;

    constructor(options: Hypermedia.Options) {
        this.event$ = new Observable((observer) => {
            this.eventObserver = observer;
        });

        this.resourceGraph = new Graph();

        this.state = {
            baseUri: options.baseUri,
            curies: options.curies,
            tags: {},
            indexes: {},
            resourceGraph: this.resourceGraph,
            suffix: options.suffix || '.json',
        };
        this.files = {};
        this.processors = options.processors;
        this.router = Router();
        this.router.get('/*', this.middleware);
    }

    // pagination:
    // time cursor based, options: skip, limit.

    protected middleware = (req: Request, res: Response, next: NextFunction) => {
        const resource = this.getResource(req.path);
        if(!resource) {
            return next();
        }

        return res.status(200).json(resource);
    }

    protected log(event: Hypermedia.Event): void {
        this.eventObserver.next(event);
    }

    // TODO: make this work with different MIME types with sensible default beahvior
    public normalizeUri(relativeUri: HAL.Uri): HAL.Uri {
        if(relativeUri.slice(-1) === '/') {
            return `${relativeUri}index${this.state.suffix}`;
        }
        else if(relativeUri.lastIndexOf('.') < relativeUri.lastIndexOf('/')) {
            return relativeUri + this.state.suffix;
        }
        return relativeUri;
    }

    public getResource(relativeUri: HAL.Uri): HAL.Resource | undefined {
        if(relativeUri.slice(-1) === '/') {
            const node = this.resourceGraph.node(this.normalizeUri(relativeUri) || this.resourceGraph.node(relativeUri));
            return node && (node.resource || node.originalResource);
        }
        else if(relativeUri.lastIndexOf('.') < relativeUri.lastIndexOf('/')) {
            // no file extension, try to find a file with the default suffix
            // TODO: store a set of "suffixes", pick based on Accept header, or use default 'suffix' if missing
            const node = this.resourceGraph.node(`${relativeUri}${this.state.suffix}`) || this.resourceGraph.node(relativeUri) || this.resourceGraph.node(this.normalizeUri(relativeUri + '/'));
            return node && (node.resource || node.originalResource);

        }
        const node = this.resourceGraph.node(relativeUri);
        return node && (node.resource || node.originalResource);
    }

    public getByUri<T>(dict: Map<string, T>, relativeUri: HAL.Uri): T | undefined {
        if(relativeUri.slice(-1) === '/') {
            return dict.get(this.normalizeUri(relativeUri)) || dict.get(relativeUri);
        }
        return dict.get(relativeUri);
    }

    public deleteByUri<T>(dict: Map<string, T>, relativeUri: HAL.Uri): boolean;
    public deleteByUri(dict: Set<string>, relativeUri: HAL.Uri): boolean;
    public deleteByUri<T>(dict: Map<string, T> | Set<string>, relativeUri: HAL.Uri): boolean {
        if(relativeUri.slice(-1) === '/') {
            const indexUri = this.normalizeUri(relativeUri);
            if(dict.has(indexUri)) {
                return dict.delete(indexUri);
            }
            else {
                return dict.delete(relativeUri);
            }
        }
        return dict.delete(relativeUri);
    }

    /**
     * @param processor - the processor that formed the dependency
     * @returns true if the dependency did not exist before for this processor
     */
    protected addDependency(relativeUriSource: HAL.Uri, relativeUriTarget: HAL.Uri, processor: Processor): boolean {
        const edge: ResourceEdge | undefined = this.resourceGraph.edge(relativeUriSource, relativeUriTarget);
        if(!edge) {
            this.resourceGraph.setEdge(relativeUriSource, relativeUriTarget, {
                processors: [processor]
            });

            this.log({
                eType: 'AddDependency',

                v: relativeUriSource,
                w: relativeUriTarget,
                processor: processor.name,
            });
            return true;
        }

        if(!edge.processors.find((p) => processor === p)) {
            edge.processors.push(processor);
            this.log({
                eType: 'AddDependency',

                v: relativeUriSource,
                w: relativeUriTarget,
                processor: processor.name,
            });
            return true;
        }

        return false;
    }

    public loadResource(relativeUri: HAL.Uri, resource: HAL.Resource, origin: string): HAL.Resource {
        const normalizedUri = this.normalizeUri(relativeUri);
        // should we warn if reloading a resource? or take a hint about a reload?
        // it's probably fine
        // if(this.resourceGraph.hasNode(normalizedUri)) {
            // throw new Error(`Resource ${normalizedUri} already loaded`);
        // }
        this.resourceGraph.setNode(normalizedUri, {
            originalResource: resource,
            processing: false,
            origin
        });

        this.log({
            eType: 'LoadResource',

            relativeUri: normalizedUri,
            resource,
        });

        return resource;
    }

    public unloadResource(relativeUri: HAL.Uri): HAL.Resource {
        const normalizedUri = this.normalizeUri(relativeUri);
        const resource = this.resourceGraph.node(normalizedUri);
        this.resourceGraph.removeNode(normalizedUri);

        this.log({
            eType: 'UnloadResource',

            relativeUri: normalizedUri,
        });
        return resource;
    }

    public processResource(relativeUri: HAL.Uri): HAL.Resource {
        const startTime = hrtime.bigint();
        const normalizedUri = this.normalizeUri(relativeUri);

        const node: ResourceNode | undefined = this.resourceGraph.node(normalizedUri);
        if(!node) {
            console.log(`Resource ${normalizedUri} has not been loaded, skipping`);
            return {};
            // throw new Error(`Resource ${normalizedUri} has not been loaded`);
        }

        if(node.processing) {
            console.log(`Resource ${normalizedUri} is already being processed, skipping`);
            return node.resource!;
            // throw new Error(`Resource ${normalizedUri} is already being processed`);
        }

        node.processing = true;

        this.log({
            eType: 'ProcessResourceStart',
            relativeUri: normalizedUri,
        });

        // reset dependencies
        const oldDependencies = this.resourceGraph.nodeEdges(normalizedUri) as Edge[];
        oldDependencies
            .filter(({v, w}) => v === normalizedUri)
            .forEach(({v, w}) => this.resourceGraph.removeEdge(v, w));

        // TODO: figure out the normalized uri mess
        const result = this.processors.reduce(
            (d, processor) => {
                return processor.fn({
                    ...d, 
                    hypermedia: this,
                    calculateFrom: (dependencyUri: HAL.Uri | HAL.Uri[], fn: Hypermedia.CalculateFromResourceFn | Hypermedia.CalculateFromResourcesFn): any => {
                        const dependencyUris = Array.isArray(dependencyUri)? dependencyUri: [dependencyUri];
                        // process dependencies
                        const dependencyResourceParams: Hypermedia.CalculateFromResourceParams[] = dependencyUris.map((uri) => {
                            const normalizedDependencyUri = this.normalizeUri(uri);
                            const dependencyResource: ResourceNode = this.resourceGraph.node(normalizedDependencyUri);
                            if(!dependencyResource) {
                                this.log({
                                    eType: 'ProcessorError',
                                    relativeUri: normalizedUri,
                                    error: new Error(`Resource ${normalizedDependencyUri} has not been loaded`)
                                });
                                return {href: normalizedDependencyUri, resource: undefined};
                            }

                            if(normalizedDependencyUri !== normalizedUri) {
                                this.addDependency(normalizedUri, normalizedDependencyUri, processor);

                                if(!dependencyResource.resource) {
                                    this.processResource(normalizedDependencyUri);
                                }
                            }

                            return {href: normalizedDependencyUri, resource: dependencyResource.resource};
                        });

                        return Array.isArray(dependencyUri)?
                            (fn as Hypermedia.CalculateFromResourcesFn)(dependencyResourceParams):
                            (fn as Hypermedia.CalculateFromResourceFn)(dependencyResourceParams[0]);
                    },
                    markDirty: (uri: HAL.Uri | HAL.Uri[], template?: string | Hypermedia.ExtendedResource) => {
                        return (Array.isArray(uri)?
                            uri:
                            [uri]
                        ).forEach((u) => {
                            if(template && !this.getResource(u)) {
                                const newResource = typeof template === 'string'?
                                    this.getResource(template):
                                    template;

                                if(newResource) {
                                    this.loadResource(u, newResource, processor.name);
                                }
                            }
                            this.addDependency(this.normalizeUri(u), normalizedUri, processor)
                        })
                    }
                });
            }, {resource: node.originalResource, relativeUri: normalizedUri, state: this.state});

        this.state = result.state;
        node.resource = result.resource;

        const endTime = hrtime.bigint();

        this.log({
            eType: 'ProcessResource',
            duration: Number(endTime - startTime)/1000000,
            edges: this.resourceGraph.nodeEdges(normalizedUri) as Edge[],
            relativeUri,
            resource: result.resource,
        });

        node.processing = false;

        // reprocess dependent resources
        (this.resourceGraph.nodeEdges(normalizedUri) as Edge[])
            .filter(({v, w}) => v !== normalizedUri)
            .forEach(({v, w}) => this.processResource(v));

        return node.resource;
    }

    /** processes each loaded resource that has not already been processed */
    public processLoadedResources() {
        this.resourceGraph.nodes()
            .filter((uri) => !this.resourceGraph.node(uri).resource)
            .forEach((uri) => {
                // check if this resource was processed as a dependency
                if(!this.resourceGraph.node(uri).resource) {
                    // console.log('processing', uri);
                    this.processResource(uri)
                }
            });
    }

    /** processes every resource e.g. after adding a new processor. only processes resources with no dependents so dependencies will cascade through all resources */
    public processAllResources() {
        this.resourceGraph.nodes()
            .filter((uri) => {
                const inEdges = this.resourceGraph.inEdges(uri);
                return inEdges && inEdges.length === 0;
            })
            .forEach((uri) => {
                this.processResource(uri)
        });
    }

    /** recursively load files in a directory */
     public loadDirectory(directoryPath: string, relativeUri: HAL.Uri = ''): Promise<Hypermedia.ResourceMap> {
         return walkDirectory(
             directoryPath,
             (filePath: string, uri: string, fileContents: string) => {
                 this.files[uri] = fileContents;
                 if(Path.extname(filePath) === '.json') {
                     return this.loadResource(uri, JSON.parse(fileContents), 'fs');
                 }
                 // TODO: don't return empty resource
                 return {};
             },
             relativeUri,
         );
     }
}

export namespace Hypermedia {
    export interface Options {
        /** if provided, this string prefixes the "href" property on all all site-local links. e.g. "https://example.com" */
        baseUri?: string;
        curies: HAL.Curie[];
        processors: Processor[];
        /** resource suffix e.g. `.json`. you must include the first period (.) */
        suffix?: string;
    }

    /** Dynamically calculated properties of the hypermedia site. */
    export interface State {
        baseUri?: HAL.Uri;
        curies: HAL.Curie[];
        /** maps tag name to list of URIs that contain this tag */
        tags: {[tag: string]: HAL.Uri[]};
        /** maps profiles to list of hrefs that have that profile */
        indexes: {[profile: string]: HAL.Uri[]};
        suffix: string;
        resourceGraph: Graph;
    }

    export interface ExtendedResource extends HAL.Resource {
        [uri: string]: any;
    }

    export interface ResourceState<R extends HAL.Resource = ExtendedResource, S extends State = State> {
        resource: R;
        relativeUri: string;
        state: S;
        /** call this function to calculate values based on other resources.
         * has the side-effect of letting the processing engine know to reprocess this file
         * whenever the dependency changes.
         * if a resource is not found, it is replaced with `undefined`
         */
        calculateFrom: CalculateFromResource;
        /** notify that a change in the resource has cascading effects on another resource.
         * @param relativeUri - a uri or array of uris that should be reprocessed
         * @param template - if provided, will create a resource for each relativeUri if no resource exists.
         *          if a string, copies the resource at the given url if it exists
         *          if an object, a deep copy is made from this resource to create each new resource.
         */
        markDirty: (relativeUri: HAL.Uri | HAL.Uri[], template?: string | ExtendedResource) => void;
        /** the hypermedia engine instance */
        hypermedia: Hypermedia;
    }

    export type CalculateFromResource = {
        (relativeUri: HAL.Uri, fn: CalculateFromResourceFn): any;
        (relativeUri: Array<HAL.Uri>, fn: CalculateFromResourcesFn): any;
    };

    export type CalculateFromResourceFn = (r: CalculateFromResourceParams) => any;
    export type CalculateFromResourcesFn = (r: Array<CalculateFromResourceParams>) => any;

    export type CalculateFromResourceParams = {href: HAL.Uri, resource?: ExtendedResource};

    export type ResourceMap = {[uri: string]: HAL.Resource};

    /** takes in a HAL object and some external state, and returns transformed versions
     * of each. */
    export type Event = Event.ProcessResource | Event.ProcessResourceStart | Event.LoadResource  | Event.UnloadResource | Event.AddDependency | Event.ProcessorError;
    export namespace Event {
        export interface ProcessResource {
            eType: 'ProcessResource';

            /** execution time in milliseconds */
            duration: number;
            relativeUri: HAL.Uri;
            edges: Edge[];
            resource: HAL.Resource;
        }

        export interface ProcessResourceStart {
            eType: 'ProcessResourceStart';

            relativeUri: HAL.Uri;
        }

        export interface LoadResource {
            eType: 'LoadResource';

            relativeUri: HAL.Uri;
            resource: HAL.Resource;
        }

        export interface UnloadResource {
            eType: 'UnloadResource';

            relativeUri: HAL.Uri;
        }

        export interface AddDependency {
            eType: 'AddDependency';

            v: string;
            w: string;

            /** name of the processor */
            processor: string;
        }

        export interface ProcessorError {
            eType: 'ProcessorError';

            relativeUri: HAL.Uri;
            error: Error;
        }
    }
}

export interface ResourceNode {
    /** the parsed resource before any processing has been applied */
    originalResource: Hypermedia.ExtendedResource;
    /** the processed resource that will be served to the user
     * should ALWAYS be serializable. nothing fancy in the resources */
    resource?: Hypermedia.ExtendedResource;
    /** true if the resource is currently being processed */
    processing: boolean;
    /** indicates how the original resource was created */
    origin: string;
}

export interface ResourceEdge {
    processors: Processor[];
}

export type Embed = {[rel: string]: EmbedEntry};
export interface EmbedEntry {
    /** URIs of resources to embed. If omitted or fewer than "max", uses hrefs from the resource's _links property. */
    href?: HAL.Uri | HAL.Uri[];
    /** maximum number of entries to embed */
    max?: number;
    /** allows recursive inclusion of embedded resources. e.g. with value 1, each embedded resource will also contain its own "_embedded" property */
    depth?: number;
    /** if provided, only embed the specified properties */
    properties?: string[];
}
