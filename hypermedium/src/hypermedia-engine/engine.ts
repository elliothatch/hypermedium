import { hrtime } from 'process';

import { concat, merge, defer, from, of, Observable, Subject } from 'rxjs';
import { mergeMap, publish, refCount } from 'rxjs/operators';

import { NextFunction, Router, Request, Response } from 'express';

import { Edge } from 'graphlib';

import * as HAL from '../hal';
import * as HalUtil from '../hal-util';
import { normalizeUri } from '../hal-util';

import { ResourceGraph } from './resource-graph'
import { Processor, ResourceState } from './processor';
import { Event } from './events';

import { Logger, Serializer} from 'freshlog';
/**
 * currently:
 * processors are dumb stateless functions. every processor is executed on every resource (inefficient), and can be disabled conditionally through the use of higher-order processors.
 * A higher order processor works by locally instantiating a processor and storing it through closure.
 * Processors must manually check if the resource contains a special "options" property, and noop if not found.
 * Async is implemented by triggering processResource once the target promise has resolved. This is nice because it ensures that processes cannot hang the processor queue, but it requires a significant amount of non-trivial code to handle async situations
 *
 * ISSUES
 *  - unnecessary execution of processors
 *  - no ability to detect conflicting processor properties
 *  - confusing async support
 *  - doesn't support resource-local processors easily (have to store state, create proessors, etc.
 *  - high memory usage as number of processors increases
 *  - no logging
 *  - can only store state by making changes to core resource-state object
 *  - processor execution order determined by global registration order. this makes configuring some pages a specific way difficult (sort before or after embed, etc.
 *   - some "indexing" processsors (makeIndex/tags) need to track state about the entire site (e.g. which pages have which tags). currently they are excuted on every document once to track index state, the have additional code that only executes on "index page" resources. these would be easier to understand if they were done in two steps--a "read only" indexing step, and a separate "processor" step for building the index pages.
 *
 * GOALS
 *  - Isolated
 *    - processors can be easily written without knowlede of other processors
 *    - resources shouldn't need to worry about the "global execution order" of processors
 *    - user is notified when multiple processors modify the same properties?
 *     - configuring different processors for various types of resources should be simple
 *    - options used to configure a processor should just be passed to the processor. simplify or remove the concept of "processorFactory" which was used to accomplish this
 *
 *  - Async
 *    - doesn't hang the processor queue
 *    - shouldn't require tons of confusing boilerplate to support async functions
 *    - shouldn't span across multiple executions of the processor. all code for an async process should be contained within one execution cycle of the process.
 *    - don't trigger dependent reprocessing until the async flow is complete
 *       - multiple async processors on the same resource are "bundled"
 *  - static site generation
 *
 * OPTIONS
 *   - global processors include array of "matcher" functions which determine if the processor is used. much simpler and easier to use than nesting higher order processors
 *   - processors should store state with a Storage API. differentiate between persistent storage and temporary/intermediate storage
 *   - support dependency processing triggered by modifications to specific properties, rather than the entire resource
 *   - instantiate processors on the fly to reduce unnecessary memory usage
 *   - add helper function for inserting links from another page
 *   - local processor stages? "pre" stage is executed before global processors, "postGlobal" executed after local, "post" executes locally after postGlobal
 *   - higher-order processors are still useful as they allow constructs like "forEach" to be added. support these by making them first-class i.e. easy to execute other processors from the current one. good "isolation" makes this possible without a ton of boilerplate or extra work.
 *
 * SOLUTIONS
 *   - global processors only should be used if you actually want the processor to be executed on every document or every "matching" document
 *   - local processors executed after global processors. instantiated only for as long as the resource is actully being processed
 */
/**
 * Processor Phases:
 * 1. embedding
 */

// TODO: add log functions to processors
/** augments a hypermedia site with dynamic properties and resources
 * for example, adds "self" links and "breadcrumb"
 * dynamic resources like comments can be updated with CRUD actions through hypermedia
 * dynamic tagging
 * use middleware to extend resources that match a certain profile
 */

// TODO: maybe it would make sense to mark certain resources as "deferred" so they only get processed after a moment of inactivity. prevents state resources (e.g. index) from being processed every time a new resource is loaded during the initial filesystem walk

export class HypermediaEngine {
    public router: Router;
    public resourceGraph: ResourceGraph;
    public processorDefinitions: Map<string, Processor.Definition>;
    public globalProcessors: {
        pre: Processor[],
        post: Processor[],
    };

    public globalStateProcessors: {
        pre: Processor[],
        post: Processor[],
    };

    public events: Observable<Event>;
    protected eventsSubject: Subject<Event>;

    constructor(options?: HypermediaEngine.Options) {
        this.resourceGraph = new ResourceGraph();
        this.processorDefinitions = new Map();
        this.globalProcessors = {
            pre: [],
            post: [],
        };
        this.globalStateProcessors = {
            pre: [],
            post: [],
        };

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
        // if(processor.onInit) {
            // return processor.onInit(processor.options);
        // }
    }

    public addGlobalStateProcessor(processor: Processor, stage: string): void {
        (this.globalStateProcessors as any)[stage].push(processor);
        // if(processor.onInit) {
            // return processor.onInit(processor.options);
        // }
    }

    /** load a file as a hypermedia resource */
    public loadResource(uri: HAL.Uri, resource: HAL.ExtendedResource, origin: string): ResourceGraph.Node.Resource {
        const normalizedUri = normalizeUri(uri);
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
            origin
        };

        this.resourceGraph.addResource(normalizedUri, node);

        this.log({
            eType: 'LoadResource',

            uri: normalizedUri,
            resource,
        });

        return node;
    }

    public unloadResource(uri: HAL.Uri): ResourceGraph.Node | undefined {
        // TODO: the way we mix files and resources in the resource graph is kind of half baked. the naming is confusing. why do we unload a "loadFile" with "unloadResource", etc.
        const normalizedUri = normalizeUri(uri);
        const resource = this.resourceGraph.graph.node(normalizedUri);
        this.resourceGraph.graph.removeNode(normalizedUri);

        this.log({
            eType: 'UnloadResource',

            uri: normalizedUri,
        });
        return resource;
    }

    public loadFile(uri: HAL.Uri, path: string): void {
        const normalizedUri = normalizeUri(uri);
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
    public processResource(uri: HAL.Uri, prevUris?: HAL.Uri[] ): Observable<{uri: HAL.Uri, resource: HAL.ExtendedResource}> {
        return defer(() => {
            const startTime = hrtime.bigint();
            if(!prevUris) {
                prevUris = [];
            }

            const normalizedUri = normalizeUri(uri);

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

            const executeLocalProcessors = (resource: HAL.ExtendedResource): Observable<HAL.ExtendedResource> => {
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

            const executeGlobalProcessors = (resource: HAL.ExtendedResource, processors: Processor[]): Observable<HAL.ExtendedResource> => {
                if(processors.length === 0) {
                    return of(resource);
                }

                processorsExecuted.push(processors[0]);
                return this.executeProcessor(processors[0], normalizedUri, resource).pipe(
                    mergeMap((r) => executeGlobalProcessors(r, processors.slice(1)))
                );
            }

            const executeAllProcessors = normalizedUri.startsWith('/~hypermedium/state')?
            executeGlobalProcessors(resourceCopy, this.globalStateProcessors.pre).pipe(
                mergeMap((resource) => executeLocalProcessors(resource)),
                mergeMap((resource) => executeGlobalProcessors(resource, this.globalStateProcessors.post))):
            executeGlobalProcessors(resourceCopy, this.globalProcessors.pre).pipe(
                mergeMap((resource) => executeLocalProcessors(resource)),
                mergeMap((resource) => executeGlobalProcessors(resource, this.globalProcessors.post)));


                        // don't execute global processors on state objects

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

    public processAllResources(): Observable<HAL.ExtendedResource> {
        return merge(...this.resourceGraph.graph.sources().map((uri) => this.processResource(uri)));
    }

    protected executeProcessor(processor: Processor, uri: HAL.Uri, resource: HAL.ExtendedResource): Observable<HAL.ExtendedResource> {
        const processorDefinition = this.processorDefinitions.get(processor.name);
        if(!processorDefinition) {
            this.log({
                eType: 'ProcessorError',
                uri,
                error: new Error(`processor definition not found: ${processor.name}. skipping...`),
            });
            return of(resource);
        }

        const stateUri = `/~hypermedium/state/${processor.name}/`;

        const logger = new Logger({
            middleware: [{ mw: (obj) => {
                HalUtil.setProperty(obj, 'processor', processor);
                HalUtil.setProperty(obj, 'uri', uri);
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

        const markDirty: ResourceState['markDirty'] = (markUri, template) => {
            let loadedResource = false;
            if(template && !this.resourceGraph.getResource(markUri)) {
                let newResource: HAL.ExtendedResource | undefined = {};

                if(typeof template === 'string') {
                    // TODO: originalResource isn't updated when the resource providing the template changes
                    // adding a dependency doesn't work since it doesn't deal with reloading/modifying original resource
                    newResource = this.resourceGraph.getResource(template);
                    if(!newResource) {
                        logger.warn(`markDirty: template resource not found: ${template}`, {template});
                        newResource = {};
                    }
                }
                else if(typeof template === 'object') {
                    newResource = template;
                }
                else {
                    throw new Error(`markDirty: template must be string or object, but had type ${typeof template}`);
                }

                this.loadResource(normalizeUri(markUri), newResource!, processor.name);
                loadedResource = true;
            }

            this.resourceGraph.addDependency(normalizeUri(markUri), uri, processor);
            return loadedResource;
        };

        const resourceState: ResourceState = {
            resource,
            uri,
            logger,
            processor,
            markDirty,
            execProcessor: (p, r?: HAL.ExtendedResource) => {
                const processors = Array.isArray(p)? p: [p];
                return processors.reduce<Promise<HAL.ExtendedResource>>((execPromise, processor) => {
                    if(!processor || !processor.name) {
                        throw new Error(`invalid processor: ${processor}`);
                    }
                    return execPromise.then((newR) => {
                        return this.executeProcessor(processor, uri, newR).toPromise();
                    });
                }, Promise.resolve(r || resource));

            },
            getResource: (dependencyUri: HAL.Uri) => {
                const normalizedDependencyUri = normalizeUri(dependencyUri);

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
            getFile: (dependencyUri: HAL.Uri) => {
                const normalizedDependencyUri = normalizeUri(dependencyUri);

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
            getState: (property, resourcePath) => {
                const state = this.resourceGraph.getResource(stateUri + (resourcePath || ''));
                return HalUtil.getProperty(state, property);
            },
            setState: (property, value, resourcePath) => {
                const normalizedStateUri = normalizeUri(stateUri + (resourcePath || ''));

                const template = {
                    "_links": {
                        "self": {
                            "href": normalizedStateUri,
                            "title": `${processor.name} state`
                        },
                        "profile": [
                            {"href": `/schema/hypermedium/state/${processor.name}`},
                            {"href": `/schema/hypermedium/state`},
                        ]
                    }
                };

                markDirty(normalizedStateUri, template);
                // the state shouldn't be processed as a dependency
                // this.resourceGraph.resetDependencies(normalizedStateUri);
                //
                // the state shouldn't be processed as a dependency of another state
                const prevDependencies = this.resourceGraph.graph.nodeEdges(normalizedStateUri) as Edge[];
                prevDependencies
                    .filter(({v, w}) => v === normalizedStateUri && w.startsWith('/~hypermedium/state'))
                    .forEach(({v, w}) => this.resourceGraph.graph.removeEdge(v, w));


                const stateNode = this.resourceGraph.graph.node(normalizedStateUri);
                stateNode.originalResource = HalUtil.setProperty(stateNode.originalResource, property, value);

                return stateNode.originalResource;
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


    // protected calculateFromFactory(uri: HAL.Uri, processor: Processor): CalculateFromResource {
    //     return(dependencyUri: HAL.Uri | HAL.Uri[], fn: CalculateFromResourceFn | CalculateFromResourcesFn) => {
    //         const dependencyUris = Array.isArray(dependencyUri)? dependencyUri: [dependencyUri];
    //         // process dependencies
    //         const dependencyResourceParams: CalculateFromResourceParams[] = dependencyUris.map((uri) => {
    //             const normalizedDependencyUri = normalizeUri(uri);
    //             const dependencyResource = this.resourceGraph.graph.node(normalizedDependencyUri);
    //             if(!dependencyResource) {
    //                 this.log({
    //                     eType: 'ProcessorError',
    //                     uri: uri,
    //                     error: new Error(`Resource ${normalizedDependencyUri} has not been loaded`)
    //                 });
    //                 return {href: normalizedDependencyUri, resource: undefined};
    //             }

    //             if(normalizedDependencyUri !== uri) {
    //                 this.resourceGraph.addDependency(uri, normalizedDependencyUri, processor);

    //                 if(!dependencyResource.resource) {
    //                     this.processResource(normalizedDependencyUri);
    //                 }
    //             }

    //             return {href: normalizedDependencyUri, resource: dependencyResource.resource};
    //         });

    //         return Array.isArray(dependencyUri)?
    //             (fn as CalculateFromResourcesFn)(dependencyResourceParams):
    //             (fn as CalculateFromResourceFn)(dependencyResourceParams[0]);
    //     };
    // }

    // protected markDirtyFactory(dependentUri: HAL.Uri, processor: Processor): (uri: HAL.Uri | HAL.Uri[], template?: string | HAL.ExtendedResource) => void {
    //     return (uri, template) => {
    //         return (Array.isArray(uri)?
    //             uri:
    //             [uri]
    //         ).forEach((u) => {
    //             if(template && !this.resourceGraph.getResource(u)) {
    //                 const newResource = typeof template === 'string'?
    //                     this.resourceGraph.getResource(template):
    //                     template;

    //                 if(newResource) {
    //                     this.loadResource(u, newResource, processor.name);
    //                 }
    //             }
    //             this.resourceGraph.addDependency(normalizeUri(u), dependentUri, processor)
    //         })
    //     }
    // }
}

export namespace HypermediaEngine {
    export interface Options {
        /** if provided, this string prefixes the "href" property on all all site-local links. e.g. "https://example.com" */
        baseUri?: string;
        /** HAL resource suffix e.g. `.json`. you must include the first period (.) */
        suffix?: string;
    }

}

// when a /schema/post is added
// add to /schema/post index
// generate body->bodyHtml
//
// when a /schema/index/schema/post is added
// get list of posts from index, add to fs:entries
// foreach fs:entries: embed title, author, date-created, excerpt
// sort by date-created

// _processors: [] list of processors that will be run on this resource in order
// _options: {} map of options that will be provided to global processors
//
// index (property): indexes resources that have the given property.
// if the value of the property is an array, use every value in the array as an index
//
//
// index('_links.profile') -> map<profile, set<uri>>
// /schema/posts -> /a, /b, /c
// /schema/books -> /d
//
// index('tags') -> map<tag, set<uri>>
// blog -> /a, /b
// hello -> /a
//
// to make a page that lists all posts
// listIndex('_links.profile', '/schema/post')
//  -> fs:entries: [/a, /b, /c]
//
// listIndex('_links.profile', '/schema/books')
//  -> fs:entries: [/d]
//
// listIndex('_links.profile')
//  -> fs:entries: {/schema/post: [/a, /b, /c], /schema/books: [/d]}
//  listIndex('tags')
//  -> fs:entries: {blog: [...], hello: [...]}
//
//  listIndex('tags', 'blog')
//  -> fs:entries: [/a, /b]
//
//
//  posts page:
//  /posts: {
//     profile: '/schema/index/_links.profile/schema/post',
//
//     _processors: [{
//          name: 'listIndex', options: {
//              index: '_links.profile',
//              value: '/schema/post',
//              //'output': 'fs:entries'
//          }}
//     ]
//
//     //fs:entries: [uris...]
//  }
//
//  tags page:
//  /tags: {
//      profile: '/schema/index/tags',
//     _processors: [
//          {name: 'listIndex', options: {
//              index: 'tags',
//              //'output': 'fs:entries'
//              // creates map object of tags
//          }},
//          {name: 'forEach', options: {
//              key: 'tags',
//              processor: 'forEach', options: {
//                  // no key
//                 processor: 'embed',
//                 options: {
//                     properties: ['title']
//                 }
//          }}
//     ]
//      //fs:entries: {tag1: [uris...], tag2: [uris...]}
//  }
//
// metaIndex (e.g. tags)
// processors are NOT a good tool for creating completely dynamic pages from data (e.g. create an index page for each tag)
// need a first-class data->document builder
//
// post -> index -> trigger create tags index. Tags page is an index of /schema/index/tags style pages
// tags page exists and contains an index of values. sub pages are generated by tags page
//
// should an "index" just be a collection (stored internally). does it make sense for "index" to autogenerate a resource (output may be specified). then the page data has to live in the processor options (bad).
// where are "data templates" stored? if generation is triggered by a root resource
// foreach "value in 
// 
