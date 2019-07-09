import * as chokidar from 'chokidar';
import * as Path from 'path';
import { promises as fs } from 'fs';
import { Socket } from 'socket.io';
import { forkJoin, of, from, fromEventPattern, merge, Observable, Subject } from 'rxjs';
import { filter, mergeMap, map, publish, tap } from 'rxjs/operators';

import { Hypermedia } from './hypermedia';
import { HypermediaRenderer } from './hypermedia-renderer';
import { BuildManager } from './build';

import { Plugin } from './plugin';
import { Processor } from './hypermedia/processor';
import { TaskDefinition } from './build';

import { FileError, NotFoundError } from './util';

// const watchObservable = bindCallback<fs.PathLike, {recursive?: boolean}, string, string>(fs.watch);

export class Freshr {
    public hypermedia: Hypermedia;
    public renderer: HypermediaRenderer;
    public build: BuildManager;

    // public watcher: chokidar.FSWatcher;
    public watchEvent$: Subject<WatchEvent>;

    public processorGenerators: Map<string, Plugin.ProcessorGenerator>;

    public sitePath: string;

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

        this.watchEvent$ = new Subject();
        this.watchEvent$.pipe(
            filter((watchEvent) => watchEvent.eType === 'add'),
            mergeMap((watchEvent) => forkJoin(
                of(watchEvent),
                from(fs.readFile(watchEvent.path, 'utf-8'))
            )),
            map(([watchEvent, fileContents]) => {
                this.hypermedia.loadResource(watchEvent.uri, JSON.parse(fileContents), 'fs');
                this.hypermedia.processResource(watchEvent.uri);
            })
        ).subscribe();
    }

    watchResources(path: string): Observable<WatchEvent> {
        return fromEventPattern<[string, string]>((addHandler) => {
            const watcher = chokidar.watch(path);
            ['add', 'change', 'unlink', 'addDir', 'unlinkDir'].forEach((eventName) => {
                watcher.on(eventName, (...args: any[]) => addHandler(eventName, ...args));
            });
        }).pipe(
            map(([eventType, filename]) => {
                return {
                    eType: eventType,
                    path: filename,
                    uri: '/' + Path.relative(path, filename).replace(/\\/g, '/'),
                } as WatchEvent;
            }),
            publish((multicasted$) =>
                multicasted$.pipe(tap((watchEvent) => this.watchEvent$.next(watchEvent)))
            ),
        );
    }

    loadAndRegisterPlugins(names: string[], searchPath: string): Observable<{plugin: Plugin, module: Plugin.Module, errors: FileError[]}> {
        return merge(...names.map((name) => Plugin.load(name, searchPath))).pipe(
            map(({plugin, errors}) => ({plugin, errors, module: this.registerPlugin(plugin)}))
        );
    }

    registerPlugin(plugin: Plugin): Plugin.Module {
        const module = !plugin.moduleFactory? {}: plugin.moduleFactory({
            basePath: this.sitePath
        });

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
    }
}

export interface WatchEvent {
    eType: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';
    path: string;
    uri: string;
}


