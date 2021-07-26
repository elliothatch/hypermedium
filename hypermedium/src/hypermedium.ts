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

    public primaryModule?: Module.Instance;

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

    /** output resources as rendered HTML */
    public exportResources(targetDir: string): Observable<Hypermedium.Event.Export> {
        return from(fsPromises.mkdir(targetDir, {recursive: true})).pipe(
            mergeMap(() => {
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
    * @param options.modules - by default, export site only exports static files (mappings listed in the plugin's "files" configuration option) from the primary module, to the root of targetDir.
    * this option allows you to specify additional modules to export static files from. each module will be exported to a directory with the name of the module. the primary module is always exported
    */
    public exportSite(targetDir: string, options?: Partial<{modules: string[], overwrite: boolean}>): Observable<Hypermedium.Event.Export> {
        return from(fsPromises.mkdir(targetDir, {recursive: true})).pipe(
            mergeMap((createdDirPath) => {
                if(!options?.overwrite && !createdDirPath) {
                    throw new Error('hypermedium.exportSite: Target directory already exists. Not exporting because overwrite is disabled. Delete the directory or enable overwriting and try again.');
                }

                const moduleObservables = this.primaryModule?
                    [this.exportStaticFiles(this.primaryModule.name, targetDir)]:
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
