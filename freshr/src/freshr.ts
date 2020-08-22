import * as Process from 'process';
import * as fs from 'fs-extra';
import { concat, defer, EMPTY, from, Observable, Subject } from 'rxjs';
import { mergeAll, map, tap } from 'rxjs/operators';

import * as Build from './build';
import { BuildManager } from './build-manager';
import { HtmlRenderer } from './renderer';
import { HypermediaEngine, Processor } from './hypermedia';
import { NotFoundError, WatchEvent } from './util';
import { Plugin, Module, ProcessorFactory } from './plugin';
import { PluginManager } from './plugin-manager';

/** sets up the hypermedia engine, html renderer, and build system
 */
export class Freshr {

    public pluginManager: PluginManager;
    public hypermedia: HypermediaEngine;
    public renderer: HtmlRenderer;
    public build: BuildManager;

    protected pluginFileEvent$: Subject<Observable<WatchEvent>>;
    public watchEvent$: Observable<WatchEvent>;

    public processorFactories: Map<string, ProcessorFactory>;

    constructor(options?: Partial<Freshr.Options>) {
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
        this.watchEvent$ = this.pluginFileEvent$.pipe(
            mergeAll()
        );
    }

    /** build the module if necessary, then subscribe to moduleEvents */
    public registerModule(moduleInstance: Module.Instance): Observable<Build.Event | Module.Event> {
        let buildEvents: Observable<Build.Event> = EMPTY;
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
        hypermedia: Partial<HypermediaEngine.Options>;
        renderer: Partial<HtmlRenderer.Options>;
        // websocketServer?: Server;
    }
}
