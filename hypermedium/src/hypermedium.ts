import * as Url from 'url';
import * as Process from 'process';
import * as fs from 'fs-extra';
import * as fsPromises from 'fs/promises';
import * as Path from 'path';
import * as GraphLib from 'graphlib';
import { concat, defer, EMPTY, from, merge, of, Observable, Subject, ConnectableObservable } from 'rxjs';
import { catchError, concatMap, combineLatest, map, mergeMap, last, publish, filter, take, mapTo, tap, refCount, delayWhen } from 'rxjs/operators';

import * as Build from './build';
import { BuildManager } from './build-manager';
import { HtmlRenderer } from './renderer';
import { HypermediaEngine, ResourceGraph, Event as HypermediaEvent } from './hypermedia-engine';
import { WatchEvent, matchesFullExtension } from './util';
import { Module, Plugin } from './plugin';
import { PluginManager } from './plugin-manager';
import * as JsonLD from './json-ld';

/** sets up the hypermedia engine, html renderer, and build system
 */
export class Hypermedium {

    public pluginManager: PluginManager;
    public hypermedia: HypermediaEngine;
    public renderer: HtmlRenderer;
    public build: BuildManager;

    public mainModule?: Module.Instance;

    /** stores the computed context for each module */
    public siteContexts: Map<string, {[property: string]: any}>
    protected pluginFileEvent$: Subject<Observable<WatchEvent>>;
    // public watchEvent$: Observable<WatchEvent>;

    constructor(options?: Partial<Hypermedium.Options>) {
        this.pluginManager = new PluginManager();
        this.hypermedia = new HypermediaEngine();

        this.renderer = new HtmlRenderer(Object.assign(
            {},
            options && options.renderer,
            {
                hypermedia: this.hypermedia,
            }
        ));

        this.build = new BuildManager(Process.cwd());

        this.siteContexts = new Map();
        this.pluginFileEvent$ = new Subject();

        // this.watchEvent$ = this.pluginFileEvent$.pipe(
            // mergeAll()
        // );
    }

    // TODO: add simple initialization function that gets everything running
    // 1. takes a list of plugin names
    // 2. loads plugins
    // 3. resolves and loads dependencies
    // 4. initializes modules using topological sort of plugin dependency graph
    //    a. create module
    //    b. once 'module initialized' event is completed, build the plugin with the build system
    // then the user/init script should use separate functions to:
    // 5. start the webserver
    // 6. export the site when it is built
    //
    //
    // the caller cares about a few things
    // 1. when the module is initialized (moduleinstance)
    // 2. when the module's build has completed and it is ready to use
    // 3. when all modules are initialized
    // 4. all module events (stream of events)
    // ex:
    // core -> init -> build -> READY
    // |         |       |-> build-events  -|
    // |         |---------> module-events -|
    // V                                    |
    // sass -> init -> build -> READY       |
    // |         |       |-> build-events  -|
    // |         |---------> module-events -|
    // V                                    |
    // demo -> init -> build -> READY       |
    // |         |       |-> build-events  -|
    // |         |---------> module-events -|-----> all events
    // V
    // COMPLETE
    //
    // return Observable<[Module.Instance, Observable<Module.Event | BuildEvent>]>
    // completes when all instances are initialized
    //
    // return [Observable<Module.Instance>, Observable<Module.Event | BuildEvent>[]]
    //
    // okay what I really want
    // Observable<[ModuleInstance, Observable<ModuleEvent>]

    public initializePlugins(pluginNames: string[], searchPaths: string[]): {modules: Observable<Module.Instance>, moduleEvents: Observable<[Module.Event | ({eCategory: 'build-event'} & Build.Event), Module.Instance]>} {
    // public initializePlugins(pluginNames: string[], searchPaths: string[]): Observable<{module: Module.Instance, event: Module.Event | ({eCategory: 'build-event'} & Build.Event)}> {

        const moduleEventsSubject: Subject<[Observable<Module.Event | ({eCategory: 'build-event'} & Build.Event)>, Module.Instance]> = new Subject();

        const pluginsLoaded = this.pluginManager.loadPluginsAndDependencies(pluginNames, searchPaths);
        const pluginLoadOrder = GraphLib.alg.topsort(this.pluginManager.dependencyGraph).filter((plugin) => {
            return !!pluginsLoaded.find((p) => p.plugin.name === plugin);
        });

        const moduleOptions = new Map<string, any>();
        // options from plugins later in the topological sorting override those from earlier ones
        // TODO: allow merging of moduleOptions from mutiple dependencies, or instantiate dependencies with different options as seperate modules
        pluginLoadOrder.forEach((pluginName) => {
            const plugin: Plugin = this.pluginManager.dependencyGraph.node(pluginName).pluginFile.plugin;
            plugin.dependencies.forEach((dependency) => {
                if(typeof dependency === 'string') {
                    return;
                }

                moduleOptions.set(dependency.name, dependency.options);
            });
        });

        const modulesObservable = from(pluginLoadOrder).pipe(
            concatMap((pluginName) => {
                const options = moduleOptions.get(pluginName) || {};
                return this.pluginManager.createModule(pluginName, pluginName, options)
            }),
            concatMap((moduleInstance) => {
                // TODO: handle namespacing
                const moduleEvents = this.registerModule(moduleInstance, '').pipe(
                    concatMap((moduleEvent) => {
                        if(moduleEvent.eCategory === 'module'
                            && moduleEvent.eType === 'initialized'
                            && moduleInstance.module.build 
                            && moduleInstance.module.build.buildSteps) {

                            // after the module is initialized, build the module's build tasks
                            // this also sets up the filesystem watches
                            // TODO: deal with unwatching files on module unregister
                            return concat(
                                this.build.build(moduleInstance.module.build.buildSteps, moduleInstance.modulePath).pipe(
                                    map((buildEvent) => ({
                                        eCategory: 'build-event' as const,
                                        ...buildEvent
                                }))),
                                of(moduleEvent)
                            );
                        }

                        return of(moduleEvent);
                    }),
                    publish(),
                );

                moduleEventsSubject.next([moduleEvents, moduleInstance]);

                return merge(
                    moduleEvents.pipe(
                        filter((e) => e.eCategory === 'module' && e.eType === 'initialized'),
                        take(1),
                        mapTo(moduleInstance)
                    ),
                    defer(() => {
                        (moduleEvents as ConnectableObservable<any>).connect()
                        return EMPTY;
                    }),
                );
            })
        );

        return {
            modules: modulesObservable,
            moduleEvents: moduleEventsSubject.pipe(
                mergeMap(([moduleEvents, moduleInstance]) =>
                    moduleEvents.pipe(combineLatest(of(moduleInstance)))
                )
            )
        }

        // this is cleaner but it doesn't work because registerModule never completes
        // return from(pluginLoadOrder).pipe(
        //     concatMap((pluginName) => {
        //         const options = moduleOptions.get(pluginName) || {};
        //         return this.pluginManager.createModule(pluginName, pluginName, options)
        //     }),
        //     concatMap((moduleInstance) => {
        //         // TODO: handle namespacing
        //         return this.registerModule(moduleInstance, '').pipe(
        //             concatMap((moduleEvent) => {
        //                 if(moduleEvent.eCategory === 'module'
        //                     && moduleEvent.eType === 'initialized'
        //                     && moduleInstance.module.build 
        //                     && moduleInstance.module.build.buildSteps) {

        //                     // after the module is initialized, build the module's build tasks
        //                     // this also sets up the filesystem watches
        //                     // TODO: deal with unwatching files on module unregister
        //                     return concat(
        //                         this.build.build(moduleInstance.module.build.buildSteps, moduleInstance.modulePath).pipe(
        //                             map((buildEvent) => ({
        //                                 eCategory: 'build-event' as const,
        //                                 ...buildEvent
        //                         }))),
        //                         of(moduleEvent).pipe(
        //                             tap(() => {
        //                             })
        //                         ),
        //                     );
        //                 }

        //                 return of(moduleEvent);
        //             }),
        //             map((event) => {
        //                 return {
        //                     module: moduleInstance,
        //                     event
        //                 };
        //             })
        //         );
        //     })
        // );
}

    /** start handling module events
     * @param namespace - if provided, will override the default namespace (moduleInstance.name)
     * */
    public registerModule(moduleInstance: Module.Instance, namespace?: string): Observable<Module.Event> {
        let moduleNamespace = namespace != null? namespace: moduleInstance.name;
        if(moduleNamespace.length > 0) {
            moduleNamespace += '/';
        }

        return moduleInstance.moduleEvents.pipe(
            mergeMap((moduleEvent) => {
                return defer(() => {
                    switch(moduleEvent.eCategory) {
                        case 'hypermedia':
                            switch(moduleEvent.eType) {
                                case 'resource-changed':
                                    switch(moduleEvent.fileEvent) {
                                        case 'add':
                                        case'change':
                                            // we don't call processResource during the initial scan because we want to load everything and then process them in one pass
                                            if(!matchesFullExtension(moduleEvent.path, moduleInstance.module.hypermedia?.resourceExtensions || ['.json'])) {
                                                this.hypermedia.loadFile(moduleEvent.uri, moduleEvent.path);
                                                if(moduleEvent.initialScan) {
                                                    return EMPTY;
                                                }
                                                return this.hypermedia.processResource(moduleEvent.uri);
                                            }

                                            // load resource
                                            return from(fs.readFile(moduleEvent.path, 'utf-8')).pipe(
                                                mergeMap((fileContents) => {
                                                    // try {
                                                        this.hypermedia.loadResource(moduleEvent.uri, JSON.parse(fileContents));
                                                        if(moduleEvent.initialScan) {
                                                            return EMPTY;
                                                        }
                                                        return this.hypermedia.processResource(moduleEvent.uri).pipe(
                                                            tap(() => {
                                                                this.updateContext(moduleInstance, moduleNamespace, moduleEvent.uri);
                                                            })
                                                        );
                                                    // }
                                                    // catch(error) {
                                                        // if we failed to parse as json and the file is supposed to be json, it's probably a user error
                                                        // if(Path.extname(moduleEvent.path) === '.json') {
                                                            // throw error;
                                                        // }

                                                    // }
                                                })
                                            );
                                        case 'unlink':
                                            this.hypermedia.unloadResource(moduleEvent.uri);
                                            return EMPTY;
                                    }
                                case 'processor-definition-changed':
                                    this.hypermedia.processorDefinitions.set(moduleNamespace + moduleEvent.processorDefinition.name, moduleEvent.processorDefinition);
                                    return EMPTY;

                                case 'processor-changed':
                                    this.hypermedia.addGlobalProcessor(moduleEvent.processor, moduleEvent.stage);
                                    return EMPTY;
                                    // TODO: reprocess all the resources if a global processor is changed after module initialization
                                    // it's okay to not handle this for now because processors are never changed after initialization anyway
                                    // return this.hypermedia.processAllResources();
                                case 'dynamic-resource-definition-changed':
                                    this.hypermedia.dynamicResourceDefinitions.set(moduleNamespace + moduleEvent.dynamicResourceDefinition.name, moduleEvent.dynamicResourceDefinition);
                                    return EMPTY;
                                case 'dynamic-resource-changed':
                                    return this.hypermedia.addDynamicResource(moduleEvent.dynamicResource);
                            }
                        case 'renderer':
                            switch(moduleEvent.eType) {
                                case 'template-changed':
                                    switch(moduleEvent.fileEvent) {
                                        case 'add':
                                        case 'change':
                                            return from(fs.readFile(moduleEvent.path, 'utf-8')).pipe(
                                                map((fileContents) => {
                                                    this.renderer.registerTemplate(moduleNamespace + moduleEvent.uri, fileContents);
                                                })
                                            );
                                        case 'unlink':
                                            this.renderer.unregisterTemplate(moduleNamespace + moduleEvent.uri);
                                            return EMPTY;
                                    }
                                case 'template-route-added':
                                    this.renderer.addTemplatePath(moduleEvent.routerPattern, moduleEvent.templateUri);
                                    return EMPTY;
                                case 'partial-changed':
                                    switch(moduleEvent.fileEvent) {
                                        case 'add':
                                        case 'change':
                                            return from(fs.readFile(moduleEvent.path, 'utf-8')).pipe(
                                                map((fileContents) => {
                                                    this.renderer.registerPartial(moduleNamespace + moduleEvent.uri, fileContents);
                                                })
                                            );
                                        case 'unlink':
                                            this.renderer.unregisterPartial(moduleNamespace + moduleEvent.uri);
                                            return EMPTY;
                                    }
                                case 'handlebars-helper-changed':
                                    this.renderer.registerHelper(moduleNamespace + moduleEvent.name, moduleEvent.helper);
                                    return EMPTY;

                                case 'profile-layout-changed':
                                    this.renderer.setProfileLayout(moduleEvent.profile, moduleEvent.uri);
                                    return EMPTY;
                                case 'context-changed':
                                    let baseContext = moduleInstance.module.renderer?.context || {};
                                    if(typeof baseContext === 'string') {
                                        // use the resource at the url as the context
                                        const baseUri = moduleInstance.module.hypermedia?.baseUri != null?
                                            moduleInstance.module.hypermedia.baseUri:
                                            '/';
                                        const contextUri = Url.resolve(baseUri, baseContext);
                                        baseContext = this.hypermedia.resourceGraph.getResource(contextUri) || {};
                                    }

                                    this.siteContexts.set(moduleInstance.name, baseContext);
                                    const context = moduleNamespace?
                                        {[moduleNamespace]: baseContext}:
                                        baseContext;

                                    this.siteContexts.set(moduleInstance.name, context);
                                    this.renderer.siteContext = this.computeContext();

                                    return EMPTY;
                            }

                        case 'build':
                            switch(moduleEvent.eType) {
                                case 'task-definition-changed':
                                    this.build.addTaskDefinition(moduleNamespace + moduleEvent.taskDefinition.name, moduleEvent.taskDefinition);
                                    return EMPTY;
                            }
                    }
                    return EMPTY;
                }).pipe(
                    last(null, null),
                    map((_) => moduleEvent),
                    catchError((error: Error) => of({
                        eCategory: 'module' as const,
                        eType: 'error' as const,
                        error,
                        uri: (moduleEvent as any).uri
                    }))
                );
            })
        );
    }

    public computeContext(): JsonLD.Document {
        // TODO: contexts should be namespaced, or assigned in dependency topological order
        return Array.from(this.siteContexts.values()).reduce((result, ctx) => {
            return Object.assign(result, ctx);
        }, {});

    }

    public updateContext(moduleInstance: Module.Instance, moduleNamespace: string, uri: string): void {
        // TODO: context CANNOT be provided by a dynamic resource
        // TODO: update the context elsewhere, so we can update it after processAllResources without manually calling this
        const baseUri = moduleInstance.module.hypermedia?.baseUri != null?
            moduleInstance.module.hypermedia.baseUri:
            '/';
        const contextUri = typeof moduleInstance.module.renderer?.context === 'string'?
            Url.resolve(baseUri, moduleInstance.module.renderer.context):
            undefined;
        if(contextUri === uri) {
            const resource = this.hypermedia.resourceGraph.getResource(contextUri) || {};
            const context = moduleNamespace?
                {[moduleNamespace]: resource}:
                resource;

            this.siteContexts.set(moduleInstance.name, context);
            this.renderer.siteContext = this.computeContext();
        }
    }

    /** output resources as rendered HTML */
    public exportResources(targetDir: string): Observable<Hypermedium.Event.Export | HypermediaEvent.Warning> {
        // TODO: should emit Error event instead of throwing, so we don't have to cancel the entire export for a single error
        return from(fsPromises.mkdir(targetDir, {recursive: true})).pipe(
            mergeMap(() => {
                // NOTE: there probably is a more efficient way to traverse the nodes, but there doesn't seem to be a public api for it
                const resources = this.hypermedia.resourceGraph.graph.nodes();
                const writeResourceObservables = resources.map((uri) => {
                    return defer(() => {
                        const node: ResourceGraph.Node = this.hypermedia.resourceGraph.graph.node(uri);
                        if(!node) {
                            const dependencies = (this.hypermedia.resourceGraph.graph.nodeEdges(uri) as unknown as ResourceGraph.Edge[])
                                .filter(({v}) => v !== uri)
                                .map(({v}) => v);
                            return of({
                                eType: 'Warning' as const,
                                message: `Resource '${uri}' not found. The following resources have processor dependencies on this missing resource: ${dependencies.join(',')} Skipping export...`,
                                data: {from: uri, dependencies}
                            });
                        }

                        if(node.eType === 'file') {
                            const filePath = Path.join(targetDir, uri);
                            return from(fs.copy(node.path, filePath)).pipe(
                                map(() => ({
                                eType: 'Export' as const,
                                from: uri,
                                path: filePath
                            }))
                            );
                        }

                        if(!node.resource) {
                            return of({
                                eType: 'Warning' as const,
                                message: `Resource '${uri}' was exported before it was processed. Skipping export...`,
                                data: {from: uri}
                            });
                        }

                        // HAL resource
                        // TODO: this assumes all resources have exactly one extension at the end that we want to replace with .html
                        const filename = uri.split('.').slice(0, -1).join('.') + '.html';
                        const filePath = Path.join(targetDir, filename);

                        const html = this.renderer.render(node.resource, this.renderer.defaultTemplate, uri);
                        return from(fs.outputFile(filePath, html)).pipe(
                            map(() => ({eType: 'Export' as const, from: uri, path: filePath}))
                        );
                    });
                });

                return merge(...writeResourceObservables);
            })
        );
    }

    /** output files listed in the module's "files" configuration option */
    public exportStaticFiles(moduleName: string, targetDir: string): Observable<Hypermedium.Event.Export> {
        return from(fsPromises.mkdir(targetDir, {recursive: true})).pipe(
            mergeMap(() => {
                const module = this.pluginManager.modules.get(moduleName);
                if(!module) {
                    throw Error(`exportStaticFiles: Module '${moduleName}' not found.`);
                }

                return merge(...(module.module.files || []).map((file) => {
                    const mapping = typeof file === 'string'?
                        {from: file, to: ''}:
                        file;

                    const fromPath = Path.join(module.modulePath, mapping.from);
                    const toPath = Path.join(targetDir, mapping.to);
                    return from(fs.copy(fromPath, toPath)).pipe(
                        map(() => ({eType: 'Export' as const, from: fromPath, path: toPath}))
                    );
                }));
            })
        );
    }

    /** output the entire site as static files in a directory.
    * @param options.modules - by default, export site only exports static files (mappings listed in the plugin's "files" configuration option) from the main module, to the root of targetDir.
    * this option allows you to specify additional modules to export static files from. each module will be exported to a directory with the name of the module. the main module is always exported
    */
    public exportSite(targetDir: string, options?: Partial<{modules: string[], overwrite: boolean}>): Observable<Hypermedium.Event.Export | HypermediaEvent.Warning> {
        return from(fsPromises.mkdir(targetDir, {recursive: true})).pipe(
            mergeMap((createdDirPath) => {
                if(!options?.overwrite && !createdDirPath) {
                    throw new Error('hypermedium.exportSite: Target directory already exists. Not exporting because overwrite is disabled. Delete the directory or enable overwriting and try again.');
                }

                const moduleObservables = this.mainModule?
                    [this.exportStaticFiles(this.mainModule.name, targetDir)]:
                    [];

                if(options?.modules) {
                    options.modules.forEach((module) => {
                        const obs = this.exportStaticFiles(module, Path.join(targetDir, module))
                        moduleObservables.push(obs);
                    });
                }

                return merge(
                    this.exportResources(targetDir),
                    ...moduleObservables,
                );
            })
        );
    }

}

export namespace Hypermedium {
    export interface Options {
        hypermedia: Partial<HypermediaEngine.Options>;
        renderer: Partial<HtmlRenderer.Options>;
        // websocketServer?: Server;
    }

    export type Event = Event.Export;
    export namespace Event {
        /** emitted when a resource or asset is exported to the filesystem */
        export interface Export {
            eType: 'Export';
            path: string;
            from: string;
        }
    }
}
