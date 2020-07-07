import * as Process from 'process';
import * as fs from 'fs-extra';
import { concat, defer, EMPTY, from, Observable, Subject } from 'rxjs';
import { mergeAll, map, tap } from 'rxjs/operators';

import { BuildManager, BuildEvent } from './build';
import { Hypermedia, Processor } from './hypermedia';
import { HypermediaRenderer } from './hypermedia-renderer';
import { PluginManager, Module } from './plugin';
import { NotFoundError, WatchEvent } from './util';

/** sets up the hypermedia engine, html renderer, and build system
 */
export class Freshr {

    public pluginManager: PluginManager;
    public hypermedia: Hypermedia;
    public renderer: HypermediaRenderer;
    public build: BuildManager;

    protected pluginFileEvent$: Subject<Observable<WatchEvent>>;
    public watchEvent$: Observable<WatchEvent>;

    public processorFactories: Map<string, Module.ProcessorFactory>;

    constructor(options?: Partial<Freshr.Options>) {
        this.pluginManager = new PluginManager();
        this.hypermedia = new Hypermedia(Object.assign(
            {
                curies: [],
            },
            options && options.hypermedia,
            {
                processors: [],
            }
        ));

        this.renderer = new HypermediaRenderer(Object.assign(
            {},
            options && options.renderer,
            {
                hypermedia: this.hypermedia,
            }
        ));

        this.build = new BuildManager(Process.cwd());

        this.processorFactories = new Map();

        this.pluginFileEvent$ = new Subject();
        this.watchEvent$ = this.pluginFileEvent$.pipe(
            mergeAll()
        );
    }

    /** build the module if necessary, then subscribe to moduleEvents */
    public registerModule(moduleInstance: Module.Instance): Observable<BuildEvent | Module.Event> {
        let buildEvents: Observable<BuildEvent> = EMPTY;
        if(moduleInstance.module.build) {
            if(moduleInstance.module.build.taskDefinitions) {
                moduleInstance.module.build.taskDefinitions.forEach((taskDefinition) => {
                    this.build.addTaskDefinition(`${moduleInstance.name}/${taskDefinition.name}`, taskDefinition);
                });
            }

            if(moduleInstance.module.build.buildSteps) {
                buildEvents = this.build.build(moduleInstance.module.build.buildSteps, moduleInstance.modulePath);
            }
        }

        return concat(
            buildEvents,
            moduleInstance.moduleEvents.pipe(
                tap((moduleEvent) => {
                    defer(() => {
                        switch(moduleEvent.eCategory) {
                            case 'hypermedia':
                                switch(moduleEvent.eType) {
                                    case 'resource-changed':
                                        switch(moduleEvent.fileEvent) {
                                            case 'add':
                                            case'change':
                                                return from(fs.readFile(moduleEvent.path, 'utf-8')).pipe(
                                                    map((fileContents) => {
                                                        this.hypermedia.loadResource(moduleEvent.uri, JSON.parse(fileContents), 'fs');
                                                        this.hypermedia.processResource(moduleEvent.uri);
                                                    })
                                                );
                                            case 'unlink':
                                                this.hypermedia.unloadResource(moduleEvent.uri);
                                                return EMPTY;
                                        }
                                    case 'processor-factory-changed':
                                        this.processorFactories.set(`${moduleInstance.name}/${moduleEvent.name}`, moduleEvent.processorFactory);
                                        return EMPTY;
                                }
                            case 'renderer':
                                switch(moduleEvent.eType) {
                                    case 'template-changed':
                                        switch(moduleEvent.fileEvent) {
                                            case 'add':
                                            case 'change':
                                                return from(fs.readFile(moduleEvent.path, 'utf-8')).pipe(
                                                    map((fileContents) => {
                                                        this.renderer.registerTemplate(moduleEvent.uri, fileContents, moduleInstance.name);
                                                    })
                                                );
                                            case 'unlink':
                                                this.renderer.unregisterTemplate(moduleEvent.uri, moduleInstance.name);
                                                return EMPTY;
                                        }
                                    case 'partial-changed':
                                        switch(moduleEvent.fileEvent) {
                                            case 'add':
                                            case 'change':
                                                return from(fs.readFile(moduleEvent.path, 'utf-8')).pipe(
                                                    map((fileContents) => {
                                                        this.renderer.registerPartial(moduleEvent.uri, fileContents, moduleInstance.name);
                                                    })
                                                );
                                            case 'unlink':
                                                this.renderer.unregisterPartial(moduleEvent.uri, moduleInstance.name);
                                                return EMPTY;
                                        }
                                    case 'handlebars-helper-changed':
                                        this.renderer.registerHelper(`${moduleInstance.name}/${moduleEvent.name}`, moduleEvent.helper);
                                        return EMPTY;

                                    case 'profile-layout-changed':
                                        this.renderer.setProfileLayout(moduleEvent.profile, moduleEvent.layoutUri);
                                        return EMPTY;
                                }
                        }
                    }).subscribe();
                })
            )
        );
    }

        // const updateResourceSubscription = this.watchEvent$.pipe(
            // filter((watchEvent) => watchEvent.eType === 'add' || watchEvent.eType === 'change'),
            // mergeMap((watchEvent) => forkJoin(
                // of(watchEvent),
                // from(fs.readFile(watchEvent.path, 'utf-8'))
            // )),
            // tap(([watchEvent, fileContents]) => {
                // this.hypermedia.loadResource(watchEvent.uri, JSON.parse(fileContents), 'fs');
                // this.hypermedia.processResource(watchEvent.uri);
            // })
        // ).subscribe();
    // }

    // watchResources(path: string | string[], uriPrefix?: string): Observable<WatchEvent> {
        // return watchFiles(path , uriPrefix).pipe(
            // publish((multicasted$) =>
                // multicasted$.pipe(tap((watchEvent) => this.watchEvent$.next(watchEvent)))
            // )
        // );
    // }

    /*
    loadAndRegisterPlugins(names: string[], searchPath: string): Observable<{plugin: Plugin, module: Plugin.Module, errors: FileError[]}> {
        // NOTE: loads plugins one by one to avoid dependency race conditions
        // this should be properly handled by determining dependency tree and loading in topological order
        return concat(...names.map((name) => Plugin.load(name, searchPath))).pipe(
            map(({plugin, errors}) => ({plugin, errors, module: this.registerPlugin(plugin)}))
        );
    }

    registerPlugin(plugin: Plugin): Plugin.Module {
        const module = !plugin.moduleFactory? {}: plugin.moduleFactory({
            ...plugin.packageOptions,
            basePath: Path.join(plugin.path, plugin.packageOptions.basePath),
            projectPath: this.sitePath
        }, this);

        if(module.processorFactories) {
            Object.keys(module.processorFactories).forEach((generatorName) => {
                this.processorFactories.set(
                    `${plugin.name}/${generatorName}`,
                    module.processorFactories![generatorName]
                );
            });
        }

        if(module.taskDefinitions) {
            module.taskDefinitions.forEach((taskDefinition) => {
                this.build.taskDefinitions.set(taskDefinition.name, taskDefinition);
            });
        }

        if(module.profileLayouts) {
            this.renderer.profileLayouts = Object.assign({}, module.profileLayouts, this.renderer.profileLayouts);
        }

        if(this.websocketServer && module.websocketMiddleware) {
            this.websocketServer.use(module.websocketMiddleware);
        }


        if(plugin.partials) {
            plugin.partials.forEach((partial) => {
                this.renderer.registerPartial(partial, plugin.name);
            });
        }

        if(plugin.templates) {
            plugin.templates.forEach((template) => {
                this.renderer.registerTemplate(template, plugin.name);
            });
        }

        if(plugin.packageOptions.hypermedia) {
            // TODO: use the pluginWatch functionality to do this, and store the resources in-memory as File objects?
            const sitePaths = plugin.packageOptions.site.map((sitePath) => Path.join(plugin.path, sitePath));
            const watcher = this.watchResources(sitePaths, plugin.packageOptions.hypermedia.baseUrl);
            // TODO: track served plugins so we can close the watcher when it is removed/disabled
            watcher.events.subscribe();

            plugin.packageOptions.hypermedia.templatePaths.forEach((templatePath) => {
                this.renderer.addTemplatePath({
                    routerPath: plugin.packageOptions.hypermedia!.baseUrl + templatePath.routerPath,
                    templateUri: templatePath.templateUri
                });
            });
        }

        return module;
    }
    */

    addProcessor(generatorName: string, options?: any): Processor {
        const generator = this.processorFactories.get(generatorName);
        if(!generator) {
            throw new NotFoundError(generatorName);
        }

        const processor = generator(options);
        this.hypermedia.processors.push(processor);
        return processor;
    }
}

export namespace Freshr {
    export interface Options {
        hypermedia: Partial<Hypermedia.Options>;
        renderer: Partial<HypermediaRenderer.Options>;
        // websocketServer?: Server;
    }
}
