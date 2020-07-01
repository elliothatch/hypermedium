import * as chokidar from 'chokidar';
import * as Path from 'path';
import { promises as fs } from 'fs';
import { Server, Socket } from 'socket.io';
import { concat, forkJoin, of, from, fromEventPattern, merge, Observable, Subject } from 'rxjs';
import { filter, mergeMap, map, publish, tap } from 'rxjs/operators';

import { Hypermedia } from './hypermedia';
import { HypermediaRenderer } from './hypermedia-renderer';
import { BuildManager } from './build';

import { Plugin } from './plugin';
import { Processor } from './hypermedia/processor';
import { TaskDefinition } from './build';

import { FileError, NotFoundError, watchFiles, WatchEvent, Watcher } from './util';

// const watchObservable = bindCallback<fs.PathLike, {recursive?: boolean}, string, string>(fs.watch);

/** sets up the hypermedia engine, html renderer, and build system
 */
export class Freshr {
    public hypermedia: Hypermedia;
    public renderer: HypermediaRenderer;
    public build: BuildManager;

    // public watcher: chokidar.FSWatcher;
    public watchEvent$: Subject<WatchEvent>;

    public processorGenerators: Map<string, Plugin.ProcessorGenerator>;

    public sitePath: string;

    // TODO: make this more robust, use socket.io namespaces
    // public websocketMiddlewares: Plugin.WebsocketMiddleware[];
    public websocketServer: Server | undefined;

    constructor(sitePath: string, options?: Partial<Freshr.Options>) {
        this.sitePath = sitePath;
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

        this.build = new BuildManager(sitePath);

        this.processorGenerators = new Map();
        this.websocketServer = options && options.websocketServer;

        this.watchEvent$ = new Subject();
        const updateResourceSubscription = this.watchEvent$.pipe(
            filter((watchEvent) => watchEvent.eType === 'add' || watchEvent.eType === 'change'),
            mergeMap((watchEvent) => forkJoin(
                of(watchEvent),
                from(fs.readFile(watchEvent.path, 'utf-8'))
            )),
            tap(([watchEvent, fileContents]) => {
                this.hypermedia.loadResource(watchEvent.uri, JSON.parse(fileContents), 'fs');
                this.hypermedia.processResource(watchEvent.uri);
            })
        ).subscribe();
    }

    watchResources(path: string | string[], uriPrefix?: string): Watcher {
        const watcher = watchFiles(path , uriPrefix);
        return {
            close: watcher.close,
            events: watcher.events.pipe(
                publish((multicasted$) =>
                    multicasted$.pipe(tap((watchEvent) => this.watchEvent$.next(watchEvent)))
                ),
            ),
        };
    }

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

        if(module.processorGenerators) {
            Object.keys(module.processorGenerators).forEach((generatorName) => {
                this.processorGenerators.set(
                    `${plugin.name}/${generatorName}`,
                    module.processorGenerators![generatorName]
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

    addProcessor(generatorName: string, options?: any): Processor {
        const generator = this.processorGenerators.get(generatorName);
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
        websocketServer?: Server;
    }
}
