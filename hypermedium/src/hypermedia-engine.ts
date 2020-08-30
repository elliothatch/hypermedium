import * as Path from 'path';
import { promises as fs } from 'fs';
import * as Url from 'url';
import { hrtime } from 'process';

import { Observable, Subject } from 'rxjs';
import { publish, refCount } from 'rxjs/operators';

import { NextFunction, Router, Request, Response } from 'express';
import { Graph, Edge } from 'graphlib';

import * as HAL from './hal';
import { filterCuries, profilesMatch, resourceMatchesProfile, getProfiles } from './hal-util';
import { createSchema, NotFoundError, objectDifference } from './util';

// TODO: add log functions to processors
/** augments a hypermedia site with dynamic properties and resources
 * for example, adds "self" links and "breadcrumb"
 * dynamic resources like comments can be updated with CRUD actions through hypermedia
 * dynamic tagging
 * use middleware to extend resources that match a certain profile
 */
export class HypermediaEngine {
    public router: Router;
    public state: HypermediaEngine.State;

    public processorFactories: Map<string, Processor.Factory>;

    public processors: Processor[];
    /** maps relative uri to the original resource loaded from the file system */
    public files: {[uri: string]: string};

    /** each loaded resource is stored in the graph, and dependencies between resources are tracked here */
    public resourceGraph: Graph;

    // uri -> processor -> Promise
    public execAsyncResults: Map<string, Map<Processor, HypermediaEngine.ExecAsyncEntry>>;

    public event$: Observable<HypermediaEngine.Event>;
    protected eventSubject!: Subject<HypermediaEngine.Event>;

    constructor(options: HypermediaEngine.Options) {
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
        this.processorFactories = new Map();
        this.processors = options.processors;

        this.execAsyncResults = new Map();

        this.eventSubject = new Subject();
        this.event$ = this.eventSubject.pipe(
            publish(),
            refCount(),
        );

        this.router = Router();
        this.router.get('/*', this.middleware);
    }

    public makeProcessor(generatorName: string, options?: any): Processor {
        const generator = this.processorFactories.get(generatorName);
        if(!generator) {
            throw new NotFoundError(generatorName);
        }

        const processor = generator(options);
        return processor;
    }

    public addProcessor(generatorName: string, options?: any): Processor {
        const processor = this.makeProcessor(generatorName, options);
        this.processors.push(processor);
        return processor;
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

    protected log(event: HypermediaEngine.Event): void {
        this.eventSubject.next(event);
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
        const edge: HypermediaEngine.ResourceEdge | undefined = this.resourceGraph.edge(relativeUriSource, relativeUriTarget);
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

        const node: HypermediaEngine.ResourceNode | undefined = this.resourceGraph.node(normalizedUri);
        if(!node) {
            this.log({
                eType: 'Warning',
                message: `Process Resource: ${normalizedUri} has not been loaded, skipping`
            });

            return {};
            // throw new Error(`Resource ${normalizedUri} has not been loaded`);
        }

        if(node.processing) {
            this.log({
                eType: 'Warning',
                message: `Process resource: ${normalizedUri} is already being processed, skipping`
            });
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
                const execAsyncEntry = this.getExecAsyncResult(normalizedUri, processor);
                if(execAsyncEntry && execAsyncEntry.result.status !== 'pending') {
                    // delete the cache
                    const promiseMap = this.execAsyncResults.get(normalizedUri)!;
                    promiseMap.delete(processor);
                    if(promiseMap.size === 0) {
                        this.execAsyncResults.delete(normalizedUri);
                    }
                }

                const resourceState: HypermediaEngine.ResourceState = {
                    ...d, 
                    hypermedia: this,
                    calculateFrom: (dependencyUri: HAL.Uri | HAL.Uri[], fn: HypermediaEngine.CalculateFromResourceFn | HypermediaEngine.CalculateFromResourcesFn): any => {
                        const dependencyUris = Array.isArray(dependencyUri)? dependencyUri: [dependencyUri];
                        // process dependencies
                        const dependencyResourceParams: HypermediaEngine.CalculateFromResourceParams[] = dependencyUris.map((uri) => {
                            const normalizedDependencyUri = this.normalizeUri(uri);
                            const dependencyResource: HypermediaEngine.ResourceNode = this.resourceGraph.node(normalizedDependencyUri);
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
                            (fn as HypermediaEngine.CalculateFromResourcesFn)(dependencyResourceParams):
                            (fn as HypermediaEngine.CalculateFromResourceFn)(dependencyResourceParams[0]);
                    },
                    markDirty: (uri: HAL.Uri | HAL.Uri[], template?: string | ExtendedResource) => {
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
                    },
                    execAsync: (fn) => {
                        let processorMap = this.execAsyncResults.get(normalizedUri);
                        if(!processorMap) {
                            processorMap = new Map();
                            this.execAsyncResults.set(normalizedUri, processorMap);
                        }

                        let promiseStatus: 'pending' | 'resolved' | 'rejected' = 'pending';
                        const promise = fn().catch((error) => {
                            promiseStatus = 'rejected';
                            return error;
                        }).then((result) => {
                            promiseStatus = 'resolved';
                            const cachedResult = this.getExecAsyncResult(normalizedUri, processor);

                            if(!cachedResult || cachedResult.promise !== promise) {
                                // cached promise doesn't match or was deleted; discard result
                                return;
                            }

                            cachedResult.result = {
                                status: promiseStatus,
                                result,
                            };
                            this.processResource(relativeUri);
                        });

                        const entry: HypermediaEngine.ExecAsyncEntry = {
                            result: {status: promiseStatus},
                            promise
                        };
                        processorMap.set(processor, entry);
                        return entry;
                    },
                    execAsyncResult: execAsyncEntry && execAsyncEntry.result
                };

                try {
                    return processor.fn(resourceState);
                }
                catch(error) {
                    throw new Error(`Processor '${processor.name}' error: ${error}`);
                    return resourceState;
                }
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

    protected getExecAsyncResult(uri: string, processor: Processor): HypermediaEngine.ExecAsyncEntry | undefined {
        const cachedPromiseMap = this.execAsyncResults.get(uri);
        if(!cachedPromiseMap) {
            return undefined;
        }

        return cachedPromiseMap.get(processor);
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
}

export namespace HypermediaEngine {
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
        hypermedia: HypermediaEngine;
        /** Processors synchronously update a resource, and should complete very quickly to prevent blocking.
         * if a processor needs to do a long-running task, like read a file or query a database
         * it can defer execution by passing a callback to execAsync.
         * the callback will be executed outside of the processor loop.
         * when it resolves or rejects, the result is cached and this resource will reprocessed.
         * the result of the async process will be available in rs.execAsyncResult and is removed from the cache.
         * if the processor currently has an execAsyncResult with status 'pending', the result of
         * the previous execAsync call will be discarded and the resource will not be reprocessed until
         * the latest invocation is complete
         */
        execAsync: (fn: () => Promise<any>) => ExecAsyncEntry | undefined;
        /** if this resource was processed because an execAsync call completed,
         * this contains the result of the Promise.
         * this value is ONLY accessible to the resource and processor that invoked it
         * if the processor is invoked before the previous execAsync call is complete, this will
         * have the status 'pending'.
         */
        execAsyncResult?: ExecAsyncResult;
    }

    export type CalculateFromResource = {
        (relativeUri: HAL.Uri, fn: CalculateFromResourceFn): any;
        (relativeUri: Array<HAL.Uri>, fn: CalculateFromResourcesFn): any;
    };

    export type CalculateFromResourceFn = (r: CalculateFromResourceParams) => any;
    export type CalculateFromResourcesFn = (r: Array<CalculateFromResourceParams>) => any;

    export type CalculateFromResourceParams = {href: HAL.Uri, resource?: ExtendedResource};

    export type ResourceMap = {[uri: string]: HAL.Resource};
    export type ExecAsyncResult = {status: 'resolved' | 'rejected' | 'pending', result?: any};
    export type ExecAsyncEntry = {result: HypermediaEngine.ExecAsyncResult, promise: Promise<any>};

    /** takes in a HAL object and some external state, and returns transformed versions
     * of each. */
    export type Event = Event.ProcessResource | Event.ProcessResourceStart | Event.LoadResource  | Event.UnloadResource | Event.AddDependency | Event.ProcessorError | Event.Warning;
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

        export interface Warning {
            eType: 'Warning';

            message: string;
        }
    }

    export interface ResourceNode {
        /** the parsed resource before any processing has been applied */
        originalResource: ExtendedResource;
        /** the processed resource that will be served to the user
         * should ALWAYS be serializable. nothing fancy in the resources */
        resource?: ExtendedResource;
        /** true if the resource is currently being processed */
        processing: boolean;
        /** indicates how the original resource was created */
        origin: string;
    }

    export interface ResourceEdge {
        processors: Processor[];
    }
}

export interface ExtendedResource extends HAL.Resource {
    [uri: string]: any;
}


export interface Processor {
    name: string;
    fn: ProcessorFn;
}

export namespace Processor {
    export type Factory = (options?: any) => Processor;
}

/** takes in a HAL object and some external state, and returns transformed versions
 * of each. */
export type ProcessorFn = (rs: HypermediaEngine.ResourceState) => HypermediaEngine.ResourceState;
