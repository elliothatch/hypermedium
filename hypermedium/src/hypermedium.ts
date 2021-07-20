import * as Process from 'process';
import * as fs from 'fs-extra';
import * as fsPromises from 'fs/promises';
import * as Path from 'path';
import { defer, EMPTY, from, merge, of, Observable, Subject } from 'rxjs';
import { concatMap, map, mergeMap, last } from 'rxjs/operators';

import * as Build from './build';
import { BuildManager } from './build-manager';
import { HtmlRenderer } from './renderer';
import { HypermediaEngine, ResourceGraph } from './hypermedia-engine';
import { WatchEvent } from './util';
import { Module } from './plugin';
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
            mergeMap((moduleEvent) => {
                return defer(() => {
                    switch(moduleEvent.eCategory) {
                        case 'hypermedia':
                            switch(moduleEvent.eType) {
                                case 'resource-changed':
                                    switch(moduleEvent.fileEvent) {
                                        case 'add':
                                        case'change':
                                            return from(fs.readFile(moduleEvent.path, 'utf-8')).pipe(
                                                mergeMap((fileContents) => {
                                                    this.hypermedia.loadResource(moduleEvent.uri, JSON.parse(fileContents), 'fs');
                                                    return this.hypermedia.processResource(moduleEvent.uri);
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
                                    return this.hypermedia.processAllResources();
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
                    return EMPTY;
                }).pipe(
                    last(null, null),
                    map((_) => moduleEvent)
                );
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
                    // TODO: deal with build failure
                }

                return of(moduleEvent);
            }),
        );
    }

    /** output the entire site as static files in a directory
    */
    public exportSite(targetDir: string): Observable<Hypermedium.Event.Export> {
        return from(fsPromises.mkdir(targetDir, {recursive: true})).pipe(
            mergeMap((createdDirPath) => {
                if(!createdDirPath) {
                    throw new Error('hypermedium.exportSite: Target directory already exists. Not exporting to protect from accidental overwrites. Delete the directory and try again.');
                }
                // NOTE: there probably is a more efficient way to traverse the nodes, but there doesn't seem to be a public api for it
                const resources = this.hypermedia.resourceGraph.graph.nodes();
                const writeResourceObservables = resources.map((uri) => {
                    return defer(() => {
                        // TODO: this assumes all resources are .json files
                        const filename = uri.split('.').slice(0, -1).join('.') + '.html';
                        const filePath = Path.join(targetDir, filename);
                        const node: ResourceGraph.Node = this.hypermedia.resourceGraph.graph.node(uri);
                        if(!node.resource) {
                            // TODO: emit warning
                            return EMPTY;
                        }

                        const html = this.renderer.render(node.resource, this.renderer.defaultTemplate, uri);
                        return from(fs.outputFile(filePath, html)).pipe(
                            map(() => ({eType: 'Export' as const, path: filePath}))
                        );
                    });
                });

                return merge(...writeResourceObservables);
                // TODO: also output all static assets (dist directory)
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
        }
    }
}
