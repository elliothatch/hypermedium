import * as Process from 'process';
import * as fs from 'fs-extra';
import { concat, defer, EMPTY, from, of, Observable, Subject } from 'rxjs';
import { concatMap, mergeAll, map, tap } from 'rxjs/operators';

import * as Build from './build';
import { BuildManager } from './build-manager';
import { HtmlRenderer } from './renderer';
import { HypermediaEngine, Processor } from './hypermedia-engine';
import { NotFoundError, WatchEvent } from './util';
import { Plugin, Module, ProcessorFactory } from './plugin';
import { PluginManager } from './plugin-manager';

/** sets up the hypermedia engine, html renderer, and build system
 */
export class Hypermedium {

    public pluginManager: PluginManager;
    public hypermedia: HypermediaEngine;
    public renderer: HtmlRenderer;
    public build: BuildManager;

    protected pluginFileEvent$: Subject<Observable<WatchEvent>>;
    // public watchEvent$: Observable<WatchEvent>;

    public processorFactories: Map<string, ProcessorFactory>;

    constructor(options?: Partial<Hypermedium.Options>) {
        this.pluginManager = new PluginManager();
        this.hypermedia = new HypermediaEngine(Object.assign(
            {
                curies: [],
            },
            options && options.hypermedia,
            {
                processors: [],
            }
        ));

        this.renderer = new HtmlRenderer(Object.assign(
            {},
            options && options.renderer,
            {
                hypermedia: this.hypermedia,
            }
        ));

        this.build = new BuildManager(Process.cwd());

        this.processorFactories = new Map();

        this.pluginFileEvent$ = new Subject();
        // this.watchEvent$ = this.pluginFileEvent$.pipe(
            // mergeAll()
        // );
    }

    /** build the module if necessary, then subscribe to moduleEvents
     * @param namespace - if provided, will override the default namespace (moduleInstance.name)
     * */
    public registerModule(moduleInstance: Module.Instance, namespace?: string): Observable<Module.Event | ({eCategory: 'build-event'} & Build.Event)> {
        let moduleNamespace = namespace != null? namespace: moduleInstance.name;
        if(moduleNamespace.length > 0) {
            moduleNamespace += '/';
        }

        return moduleInstance.moduleEvents.pipe(
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
                                    this.processorFactories.set(moduleNamespace + moduleEvent.name, moduleEvent.processorFactory);
                                    return EMPTY;

                                case 'processor-changed':
                                    this.addProcessor(moduleEvent.name, moduleEvent.options);
                                    this.hypermedia.processAllResources();
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
                                                    this.renderer.registerTemplate(moduleNamespace + moduleEvent.uri, fileContents);
                                                })
                                            );
                                        case 'unlink':
                                            this.renderer.unregisterTemplate(moduleNamespace + moduleEvent.uri);
                                            return EMPTY;
                                    }
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
                                    this.renderer.setProfileLayout(moduleEvent.profile, moduleEvent.layoutUri);
                                    return EMPTY;
                                case 'context-changed':
                                    if(moduleNamespace) {
                                        this.renderer.siteContext = Object.assign(this.renderer.siteContext, {[moduleNamespace]: moduleEvent.context});
                                    }
                                    else {
                                        this.renderer.siteContext = Object.assign(this.renderer.siteContext, moduleEvent.context);
                                    }
                                    return EMPTY;
                            }

                        case 'build':
                            switch(moduleEvent.eType) {
                                case 'task-definition-changed':
                                    this.build.addTaskDefinition(moduleNamespace + moduleEvent.taskDefinition.name, moduleEvent.taskDefinition);
                                    return EMPTY;
                            }
                    }
                }).subscribe();
            }),
            concatMap((moduleEvent) => {
                if(moduleEvent.eCategory === 'module'
                    && moduleEvent.eType === 'initialized'
                    && moduleInstance.module.build 
                    && moduleInstance.module.build.buildSteps) {

                    // TODO: deal with unwatching files on module unregister
                    return this.build.build(moduleInstance.module.build.buildSteps, moduleInstance.modulePath).pipe(
                        map((buildEvent) => ({
                            eCategory: 'build-event' as const,
                            ...buildEvent
                        }))
                    );
                }

                return of(moduleEvent);
            }),
        );
    }

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

export namespace Hypermedium {
    export interface Options {
        hypermedia: Partial<HypermediaEngine.Options>;
        renderer: Partial<HtmlRenderer.Options>;
        // websocketServer?: Server;
    }
}
