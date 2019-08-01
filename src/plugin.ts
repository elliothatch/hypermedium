import * as Path from 'path';
import { promises as fs } from 'fs';

import { Socket } from 'socket.io';
import { forkJoin, Observable, of, from } from 'rxjs';
import { filter, toArray, map, mergeMap, catchError } from 'rxjs/operators';

import * as chokidar from 'chokidar';

import { Processor } from './hypermedia/processor';
import { PartialMap, ProfileLayoutMap, TemplateMap } from './hypermedia-renderer';
import { TaskDefinition } from './build';

import { File, FileError, loadFiles, watchFiles, WatchEvent, Watcher } from './util';

export interface Plugin {
    name: string;

    packageOptions: Plugin.PackageOptions;

    moduleFactory?: Plugin.Module.Factory;

    partials?: File[],
    templates?: File[],
}


export namespace Plugin {
    export type WebsocketMiddleware = (socket: Socket, fn: (err?: any) => void) => void;

    export type Event = Event.Package | Event.Template | Event.Partial;
    export namespace Event {
        export interface Base {
            status: 'add' | 'change' | 'unlink';
            path: string;
            uri: string;
        }
        export interface Package extends Base {
            eType: 'package';
            /** undefined when status === 'unlink' */
            options: PackageOptions;
        }

        export interface Template extends Base {
            eType: 'template';
            /** undefined when status === 'unlink' */
            contents?: string;
        }

        export interface Partial extends Base {
            eType: 'partial';
            /** undefined when status === 'unlink' */
            contents?: string;
        }

        export interface PluginError {
            eType: 'error';
            error: Error;
        }
    }

    /**
     * watches the files in a plugin, and emits events as assets are added, updated, or deleted
     * @param name - name of the plugin
     * @param searchPath - path to the directory we will search for 'name' in
     */
    export function watch(name: string, searchPath: string): Watcher<Event> {
        let templatesWatcher: Watcher | undefined;
        let partialsWatcher: Watcher | undefined;
        const watcher: Watcher = {
            close: () => {},
            events: new Subject<Event>();
        };

        const pluginPath = Path.join(searchPath, name);
        //
        // read the directory to make sure it's there and give better error message
        // return from(fs.readdir(pluginPath)).pipe(
        // );
        const packagePath = Path.join(pluginPath, 'package.json');
        const packageWatcher = watchFiles(packagePath);
        packageWatcher.events.pipe(
            mergeMap((watchEvent) => {
                // TODO: do template/partial stuff
                switch(watchEvent.eType) {
                    case 'add':
                    case 'change':
                        break;
                    case 'unlink':
                }
                return forkJoin(
                    from(watchEvent),
                    from(fs.readFile(watchEvent.path, 'utf-8'))
                );
            }),
            map(([watchEvent, contents]) => {
                const options = JSON.parse(contents); // TODO: centralize options initialization logic in load()
                watcher.events.next({
                    eType: 'package',
                    status: watchEvent.eType,
                    path: watchEvent.path,
                    uri: watchEvent.uri,
                    options
                });
                // TODO: tear down and set up watchers for templates and partials
                // switch(watchEvent.eType) {
                        // case 'add':
                // }
            })
        );
    }

    /**
     * @param name - name of the plugin
     * @param searchPath - path to the directory we will search for 'name' in
     */
    export function load(name: string, searchPath: string): Observable<{plugin: Plugin, errors: FileError[]}> {
        const pluginPath = Path.join(searchPath, name);

        // read the directory to make sure it's there and give better error message
        return from(fs.readdir(pluginPath)).pipe(
            mergeMap((files) => {
                const packagePath = Path.join(pluginPath, 'package.json');
                return from(fs.readFile(packagePath)).pipe(
                    catchError((error) => {
                        // warning: missing package.json
                        return of('{}');
                    }),
                    map((contents) => {
                        const obj = JSON.parse(contents as string);
                        return typeof obj === 'object'? obj : {};
                    }),
                    map((obj) => {
                        if(!obj.freshr) {
                            obj.freshr = {};
                        }

                        obj.freshr = {
                            ...obj.freshr,
                            baseUrl: obj.freshr.baseUrl || '.',
                            templates: obj.freshr.templates || ['templates'],
                            partials: obj.freshr.partials || ['partials'],
                        };

                        return obj;
                    }),
                );
            }),
            mergeMap((packageOptions) => {
                const mainPath = Path.join(pluginPath, packageOptions.main || 'index.js');
                let moduleFactory: Module.Factory | undefined;
                try {
                    moduleFactory = require(mainPath);
                    if(moduleFactory && (moduleFactory as any).default) {
                        moduleFactory = (moduleFactory as any).default;
                    }
                }
                catch(error) {
                    console.error(`Plugin.load: failed to load plugin: ${pluginPath} (${name}): ${error}`);
                    // warning: module not found
                }

                const templatesPaths = packageOptions.freshr.templates.map(
                    (templatesPath: string) => Path.join(
                        pluginPath,
                        packageOptions.freshr.baseUrl,
                        templatesPath)
                );
                const partialsPaths = packageOptions.freshr.partials.map(
                    (partialsPath: string) => Path.join(
                        pluginPath,
                        packageOptions.freshr.baseUrl,
                        partialsPath)
                );

                return forkJoin(
                    of(moduleFactory),
                    loadFiles(templatesPaths).pipe(toArray()),
                    loadFiles(partialsPaths).pipe(toArray())
                ).pipe(
                    map(([moduleFactory, templates, partials]) => {
                        return {
                            plugin: {
                                name,
                                packageOptions,
                                moduleFactory,
                                partials: partials.filter((file) => (file as File).contents) as File[],
                                templates: templates.filter((file) => (file as File).contents) as File[],
                            },
                            errors: partials.concat(templates).filter((file) => (file as FileError).error) as FileError[],
                        };
                    })
                );
            })
        );
    }

    /** these options may be provided in the "package.json" as an object under the "freshr" property
     */
    export interface PackageOptions {
        /** base path (relative to package.json's dir) prepended to all other path lookups. default '.' */
        baseUrl: string;
        /** list of paths (relative to baseUrl) to directories or files containing templates. default 'templates' */
        templates: string[];
        /** list of paths (relative to baseUrl) to directories or files containing partials. default 'partials' */
        partials: string[];
    }

    /** Server assets like processors and API implementations are shared by exporting
     * an object with the following properties in their "main" module (uses package.json "main" property, or index.js) */
    export interface Module {
        processorGenerators?: {[name: string]: ProcessorGenerator};
        websocketMiddleware?: WebsocketMiddleware;

        profileLayouts?: ProfileLayoutMap;

        taskDefinitions?: TaskDefinition[];
    }

    export namespace Module {
        export type Factory = (options: Options) => Module;
        export interface Options {
            /** path to the root of the project directory */
            basePath: string;
        }
    }

    export type ProcessorGenerator = (options?: any) => Processor;
}
