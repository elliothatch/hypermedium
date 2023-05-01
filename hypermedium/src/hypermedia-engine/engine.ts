import { hrtime } from 'process';
import {URL} from 'url';

import { concat, merge, defer, from, of, Observable, Subject, EMPTY } from 'rxjs';
import { mergeMap, publish, refCount } from 'rxjs/operators';

import { NextFunction, Router, Request, Response } from 'express';

import { Edge } from 'graphlib';

import * as JsonLD from '../json-ld';
import * as JsonLDUtil from '../json-ld-util';

import { ResourceGraph, DynamicResourceData } from './resource-graph'
import { Processor, ResourceState } from './processor';
import { DynamicResource } from './dynamic-resource';
import { Event } from './events';

import { Logger, Serializer, Middleware as LoggerMiddleware} from 'freshlog';

export class HypermediaEngine {
    public router: Router;
    public resourceGraph: ResourceGraph;
    public processorDefinitions: Map<string, Processor.Definition>;
    public globalProcessors: {
        pre: Processor[],
        post: Processor[],
    };

    public dynamicResourceDefinitions: Map<string, DynamicResource.Definition>;
    // TOOD: optimization: track specific resource callbacks so we don't have to iterate over this list
    public dynamicResources: DynamicResourceData[];

    public events: Observable<Event>;
    protected eventsSubject: Subject<Event>;

    constructor(options?: HypermediaEngine.Options) {
        this.resourceGraph = new ResourceGraph();
        this.processorDefinitions = new Map();
        this.globalProcessors = {
            pre: [],
            post: [],
        };
        this.dynamicResourceDefinitions = new Map();
        this.dynamicResources = [];

        this.eventsSubject = new Subject();
        this.events = this.eventsSubject.pipe(
            publish(),
            refCount(),
        );

        this.router = Router();
        this.router.get('/*', this.middleware);
    }

    protected middleware = (req: Request, res: Response, next: NextFunction) => {
        const resource = this.resourceGraph.getResource(req.path);
        if(resource) {
            return res.status(200).json(resource);
        }

        const file = this.resourceGraph.getFile(req.path);
        if(file) {
            return res.status(200).sendFile(file);
        }

        return next();
    }

    public addGlobalProcessor(processor: Processor, stage: string): void {
        (this.globalProcessors as any)[stage].push(processor);
    }

    public addDynamicResource(dynamicResource: DynamicResource) {
        return defer(() => {
            const definition = this.dynamicResourceDefinitions.get(dynamicResource.name);
            if(!definition) {
                const error = new Error(`dynamic resource definition not found: ${dynamicResource.name}`);
                this.log({
                    eType: 'DynamicResourceError',
                    dynamicResource,
                    error
                });
                throw error;
            }

            const resourceData: DynamicResourceData = {
                dynamicResource,
                definition,
                resources: new Set(),
                api: {
                    hypermedia: this,
                    state: undefined,
                    logger: new Logger(), // temprory, will be replaced by executeDynamicResourceCallback
                    createResource: (uri, resource) => {
                        const baseUri = dynamicResource.config?.baseUri || `/~hypermedium/dynamic/${dynamicResource.name}`;
                        // TODO: join uris more robustly
                        const fullUri = baseUri + (uri.startsWith('/')? '': '/') + uri;
                        const updated = this.resourceGraph.getResource(fullUri) != undefined;
                        resourceData.resources.add(fullUri);
                        this.loadResource(fullUri, resource);
                        return this.processResource(fullUri).toPromise().then(() => {
                            return {
                                resource: this.resourceGraph.getResource(fullUri)!,
                                updated
                            };
                        });
                    }
                }
            }
            this.dynamicResources.push(resourceData);

            if(definition.init) {
                return this.executeDynamicResourceCallback(resourceData, {cType: 'init'});
            }

            return EMPTY;
        });
    }

    public executeDynamicResourceCallback(resourceData: DynamicResourceData, callbackData: {cType: 'init'} | {cType: 'resource' | 'node', callbackName: 'onAdd' | 'onProcess' | 'onDelete', uri: JsonLD.IRI}) { 
        return defer(() => {
            if((callbackData.cType === 'init' && !resourceData.definition.init)
                || callbackData.cType === 'resource' && !resourceData.definition.resourceEvents?.[callbackData.callbackName]
                || callbackData.cType === 'node' && !resourceData.definition.nodeEvents?.[callbackData.callbackName]
            ) {
                return EMPTY;
            }

            const loggerMiddleware: LoggerMiddleware = callbackData.cType === 'init'?
                (obj) => {
                    JsonLDUtil.setProperty(obj, 'dynamicResource', resourceData.dynamicResource);
                    return obj;
                }: 
                (obj) => {
                    JsonLDUtil.setProperty(obj, 'dynamicResource', resourceData.dynamicResource);
                    JsonLDUtil.setProperty(obj, 'uri', callbackData.uri);
                    return obj;
                };

            resourceData.api.logger = new Logger({
                middleware: [{ mw: loggerMiddleware, levels: true }],
                serializer: Serializer.identity,
                target: {
                    name: 'dynamic-resource',
                    write: (serializedData) => {
                        this.log({
                            eType: 'DynamicResourceLog',
                            log: serializedData
                        });
                    }
                }
            });

            resourceData.api.logger.handlers.forEach((handler) => handler.enabled = true);

            try {
                let result: any | Promise<any> = undefined;
                switch(callbackData.cType) {
                    case 'init':
                        resourceData.api.logger.trace(`exec dynamic resource '${resourceData.dynamicResource.name}'.init`);
                        result = resourceData.definition.init!(resourceData.api, resourceData.dynamicResource.options);
                        break;
                    case 'node':
                        resourceData.api.logger.trace(`exec dynamic resource '${resourceData.dynamicResource.name}'.nodeEvents.${callbackData.callbackName}: ${callbackData.uri}`);
                        const node = this.resourceGraph.graph.node(callbackData.uri);
                        result = resourceData.definition.nodeEvents![callbackData.callbackName]!(callbackData.uri, node, resourceData.api, resourceData.dynamicResource.options);
                        break;
                    case 'resource':
                        resourceData.api.logger.trace(`exec dynamic resource '${resourceData.dynamicResource.name}'.resourceEvents.${callbackData.callbackName}: ${callbackData.uri}`);
                        const resource = this.resourceGraph.getResource(callbackData.uri)!;
                        result = resourceData.definition.resourceEvents![callbackData.callbackName]!(callbackData.uri, resource, resourceData.api, resourceData.dynamicResource.options);
                }
                if(result instanceof Promise) {
                    return from(result);
                }

                return of(result);
            }
            catch(error) {
                const err = new Error(`Dynamic Resource '${resourceData.dynamicResource.name}' error: ${error}`);
                this.log({
                    eType: 'DynamicResourceError',
                    error: err,
                    dynamicResource: resourceData.dynamicResource,
                    uri: (callbackData as any).uri
                });
                throw err;
            }
        });
    }

    /** load a file as a hypermedia resource */
    public loadResource(uri: JsonLD.IRI, resource: JsonLD.Document, dynamic?: DynamicResourceData): ResourceGraph.Node.Resource {
        const normalizedUri = JsonLDUtil.normalizeUri(uri);
        if(this.resourceGraph.graph.hasNode(normalizedUri)) {
            if(this.resourceGraph.graph.node(normalizedUri)) {
                // if hasNode returns true but the node is undefined, it was only created as a placeholder for a dependency, so we don't need to show a warning
                // also, this probably can just be a trace instead of a warning
                this.log({
                    eType: 'Warning',
                    message: `Resource ${normalizedUri} already loaded. Overwriting...`,
                });
            }
        }

        const node: ResourceGraph.Node.Resource = {
            eType: 'resource',
            originalResource: resource,
            dynamic
        };

        this.resourceGraph.addResource(normalizedUri, node);

        this.log({
            eType: 'LoadResource',

            uri: normalizedUri,
            resource,
        });

        concat(
            merge(...this.dynamicResources.filter((resourceData) => resourceData.definition.nodeEvents?.onAdd).map((resourceData) => {
                return this.executeDynamicResourceCallback(resourceData, {cType: 'node', callbackName: 'onAdd', uri});
            })),
            merge(...this.dynamicResources.filter((resourceData) => resourceData.definition.resourceEvents?.onAdd).map((resourceData) => {
                return this.executeDynamicResourceCallback(resourceData, {cType: 'resource', callbackName: 'onAdd', uri});
            }))
        ).subscribe({
            next: (result) => {
            },
            error: (err) => {
            }
        });

        return node;
    }

    public unloadResource(uri: JsonLD.IRI): ResourceGraph.Node | undefined {
        // TODO: the way we mix files and resources in the resource graph is kind of half baked. the naming is confusing. why do we unload a "loadFile" with "unloadResource", etc.
        const normalizedUri = JsonLDUtil.normalizeUri(uri);
        const resource = this.resourceGraph.graph.node(normalizedUri);
        this.resourceGraph.graph.removeNode(normalizedUri);

        this.log({
            eType: 'UnloadResource',

            uri: normalizedUri,
        });

        concat(
            merge(...this.dynamicResources.filter((resourceData) => resourceData.definition.nodeEvents?.onDelete).map((resourceData) => {
                return this.executeDynamicResourceCallback(resourceData, {cType: 'node', callbackName: 'onDelete', uri});
            })),
            merge(...this.dynamicResources.filter((resourceData) => resourceData.definition.resourceEvents?.onDelete).map((resourceData) => {
                return this.executeDynamicResourceCallback(resourceData, {cType: 'resource', callbackName: 'onDelete', uri});
            }))
        ).subscribe({
            next: (result) => {
            },
            error: (err) => {
            }
        });

        return resource;
    }

    public loadFile(uri: JsonLD.IRI, path: string): void {
        const normalizedUri = JsonLDUtil.normalizeUri(uri);
        if(this.resourceGraph.graph.hasNode(normalizedUri)) {
            if(this.resourceGraph.graph.node(normalizedUri)) {
                // if hasNode returns true but the node is undefined, it was only created as a placeholder for a dependency, so we don't need to show a warning
                // also, this probably can just be a trace instead of a warning
                this.log({
                    eType: 'Warning',
                    message: `Resource ${normalizedUri} already loaded. Overwriting...`,
                });
            }
        }

        const node: ResourceGraph.Node.File = {
            eType: 'file',
            path,
        };

        this.resourceGraph.addResource(normalizedUri, node);

        this.log({
            eType: 'LoadFile',

            uri: normalizedUri,
            path
        });
    }

    /** returns observable with each resource that is processed as a result of this one */
    public processResource(uri: JsonLD.IRI, prevUris?: JsonLD.IRI[] ): Observable<{uri: JsonLD.IRI, resource: JsonLD.Document}> {
        return defer(() => {
            const startTime = hrtime.bigint();
            if(!prevUris) {
                prevUris = [];
            }

            const normalizedUri = JsonLDUtil.normalizeUri(uri);

            if(prevUris.includes(normalizedUri)) {
                const cycle = prevUris.concat(uri);
                const error = new Error(`Process Resource: cycle detected ${cycle}`);
                (error as any).cycle = cycle;
                // throw error;
                this.log({
                    eType: 'Warning',
                    message: error.message,
                    data: {cycle},
                });
                return of({uri: normalizedUri, resource: {}});
            }

            this.log({
                eType: 'ProcessResourceStart',
                uri: normalizedUri,
            });

            const node: ResourceGraph.Node | undefined = this.resourceGraph.graph.node(normalizedUri);
            if(!node) {
                this.log({
                    eType: 'Warning',
                    message: `Process Resource: ${normalizedUri} not found, skipping`
                });

                return of({uri: normalizedUri, resource: {}});
            }

            if(node.eType === 'file') {
                // when processing a file, just process the dependencies
                const endTime = hrtime.bigint();
                this.log({
                    eType: 'ProcessResource',
                    duration: Number(endTime - startTime)/1000000,
                    edges: this.resourceGraph.graph.nodeEdges(normalizedUri) as unknown as ResourceGraph.Edge[],
                    uri: normalizedUri,
                    resource: {path: node.path},
                    processors: []
                });

                const dependentResourceObservables = (this.resourceGraph.graph.nodeEdges(normalizedUri) as unknown as Edge[])
                    .filter(({v}) => v !== normalizedUri)
                    .map(({v}) => this.processResource(v, prevUris!.concat(normalizedUri)));


                return concat(
                    of({uri: normalizedUri, resource: {path: node.path}}),
                    merge(...dependentResourceObservables)
                );
            }

            // reset
            this.resourceGraph.resetDependencies(normalizedUri);
            const resourceCopy = JSON.parse(JSON.stringify(node.originalResource));

            // track processors used for debugging
            const processorsExecuted: Processor[] = [];

            const executeLocalProcessors = (resource: JsonLD.Document): Observable<JsonLD.Document> => {
                if(!resource._processors || resource._processors.length === 0) {
                    return of(resource);
                }

                const processor = resource._processors[0];
                if(resource._processors.length > 1) {
                    resource._processors = resource._processors.slice(1);
                }
                else {
                    delete resource._processors;
                }

                processorsExecuted.push(processor);
                return this.executeProcessor(processor, normalizedUri, resource).pipe(
                    mergeMap(executeLocalProcessors)
                );
            };

            const executeGlobalProcessors = (resource: JsonLD.Document, processors: Processor[]): Observable<JsonLD.Document> => {
                if(processors.length === 0) {
                    return of(resource);
                }

                processorsExecuted.push(processors[0]);
                return this.executeProcessor(processors[0], normalizedUri, resource).pipe(
                    mergeMap((r) => executeGlobalProcessors(r, processors.slice(1)))
                );
            }

            const executeAllProcessors = executeGlobalProcessors(resourceCopy, this.globalProcessors.pre).pipe(
                mergeMap((resource) => executeLocalProcessors(resource)),
                mergeMap((resource) => executeGlobalProcessors(resource, this.globalProcessors.post)));


            return executeAllProcessors.pipe(
                mergeMap((resource) => {
                    node.resource = resource;

                    const endTime = hrtime.bigint();

                    this.log({
                        eType: 'ProcessResource',
                        duration: Number(endTime - startTime)/1000000,
                        edges: this.resourceGraph.graph.nodeEdges(normalizedUri) as unknown as ResourceGraph.Edge[],
                        uri: normalizedUri,
                        resource,
                        processors: processorsExecuted
                    });

                    // TODO: since calling dynamic resource callbacks can trigger processing, maybe it is a very bad idea to invoke it as a side effect outside of the processResource flow.
                    concat(
                        merge(...this.dynamicResources.filter((resourceData) => resourceData.definition.nodeEvents?.onProcess).map((resourceData) => {
                            return this.executeDynamicResourceCallback(resourceData, {cType: 'node', callbackName: 'onProcess', uri});
                        })),
                        merge(...this.dynamicResources.filter((resourceData) => resourceData.definition.resourceEvents?.onProcess).map((resourceData) => {
                            return this.executeDynamicResourceCallback(resourceData, {cType: 'resource', callbackName: 'onProcess', uri});
                        }))
                    ).subscribe({
                        next: (result) => {
                        },
                        error: (err) => {
                        }
                    });

                    const dependentResourceObservables = (this.resourceGraph.graph.nodeEdges(normalizedUri) as unknown as Edge[])
                        .filter(({v}) => v !== normalizedUri)
                        .map(({v}) => this.processResource(v, prevUris!.concat(normalizedUri)));


                    return concat(
                        of({uri: normalizedUri, resource}),
                        merge(...dependentResourceObservables)
                    );
                })
            );
        });
    }

    public processAllResources(): Observable<JsonLD.Document> {
        return merge(...this.resourceGraph.graph.sources().map((uri) => this.processResource(uri)));
    }

    protected executeProcessor(processor: Processor, uri: JsonLD.IRI, resource: JsonLD.Document): Observable<JsonLD.Document> {
        const processorDefinition = this.processorDefinitions.get(processor.name);
        if(!processorDefinition) {
            this.log({
                eType: 'ProcessorError',
                uri,
                error: new Error(`processor definition not found: ${processor.name}. skipping...`),
            });
            return of(resource);
        }

        const logger = new Logger({
            middleware: [{ mw: (obj) => {
                JsonLDUtil.setProperty(obj, 'processor', processor);
                JsonLDUtil.setProperty(obj, 'uri', uri);
                return obj;
            }, levels: true }],
            serializer: Serializer.identity,
            target: {
                name: 'processor',
                write: (serializedData) => {
                    this.log({
                        eType: 'ProcessorLog',
                        log: serializedData
                    });
                }
            }
        });

        logger.handlers.forEach((handler) => handler.enabled = true);

        const resourceState: ResourceState = {
            resource,
            uri,
            logger,
            processor,
            execProcessor: (p, r?: JsonLD.Document) => {
                const processors = Array.isArray(p)? p: [p];
                return processors.reduce<Promise<JsonLD.Document>>((execPromise, processor) => {
                    if(!processor || !processor.name) {
                        throw new Error(`invalid processor: ${processor}`);
                    }
                    return execPromise.then((newR) => {
                        return this.executeProcessor(processor, uri, newR).toPromise();
                    });
                }, Promise.resolve(r || resource));

            },
            getResource: (dependencyUri: JsonLD.IRI) => {
                const normalizedDependencyUri = JsonLDUtil.normalizeUri(dependencyUri);

                const r = this.resourceGraph.getResource(normalizedDependencyUri);
                // add the dependency, even if the target node doesn't exist yet
                // this allows processors to trigger if the dependency is loaded later
                // TODO: find a way to suppress processor errors that occur because of this?
                const result = this.resourceGraph.addDependency(uri, normalizedDependencyUri, processor);
                if(r) {
                    if(result) {
                        this.log({
                            eType: 'AddDependency',

                            v: uri,
                            w: normalizedDependencyUri,
                            processor: processor.name,
                        });
                    }
                }

                return r;
            },
            getFile: (dependencyUri: JsonLD.IRI) => {
                const normalizedDependencyUri = JsonLDUtil.normalizeUri(dependencyUri);

                const r = this.resourceGraph.getFile(normalizedDependencyUri);
                // add the dependency, even if the target node doesn't exist yet
                // this allows processors to trigger if the dependency is loaded later
                // TODO: find a way to suppress processor errors that occur because of this?
                const result = this.resourceGraph.addDependency(uri, normalizedDependencyUri, processor);
                if(r) {
                    if(result) {
                        this.log({
                            eType: 'AddDependency',

                            v: uri,
                            w: normalizedDependencyUri,
                            processor: processor.name,
                        });
                    }
                }

                return r;
            },
            hypermedia: this
        };

        logger.trace(`exec processor ${uri}: ${processor.name}`);
        try {
            const result = processorDefinition.onProcess(resourceState, processor.options);
            if(result instanceof Promise) {
                return from(result);
            }

            return of(result);
        }
        catch(error) {
            this.log({
                eType: 'ProcessorError',
                uri,
                error: new Error(`Processor '${processor.name}' error: ${error}`),
            });
            return of(resource);
        }

    }

    protected log(event: Event): void {
        this.eventsSubject.next(event);
    }
}

export namespace HypermediaEngine {
    export interface Options {
        /** if provided, this string prefixes the "href" property on all all site-local links. e.g. "https://example.com" */
        baseUri?: string;
        /** HAL resource suffix e.g. `.json`. you must include the first period (.) */
        suffix?: string;
    }

}
