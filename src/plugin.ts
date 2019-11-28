import * as Path from 'path';
import { promises as fs } from 'fs';

import { Socket } from 'socket.io';
import { forkJoin, Observable, of, from, Subject } from 'rxjs';
import { filter, toArray, map, mergeMap, catchError } from 'rxjs/operators';

import * as chokidar from 'chokidar';

import { Processor } from './hypermedia/processor';
import { PartialMap, ProfileLayoutMap, TemplateMap, TemplatePath } from './hypermedia-renderer';
import { TaskDefinition, BuildStep } from './build';

import { File, FileError, loadFiles, watchFiles, WatchEvent, Watcher } from './util';
import { Freshr } from './freshr';

export interface Plugin {
    name: string;
    /** path to the root of the plugin on the filesystem */
    path: string;

    packageOptions: Plugin.PackageOptions;

    moduleFactory?: Plugin.Module.Factory;

    partials?: File[],
    templates?: File[],
}


export namespace Plugin {
    export type WebsocketMiddleware = (socket: Socket, fn: (err?: any) => void) => void;
    export type PackageJson = {[key: string]: any} & {freshr: PackageOptions};

    export type Event = Event.Package | Event.Template | Event.Partial | Event.PluginError;
    export namespace Event {
        export interface Base {
            status: 'add' | 'change' | 'unlink';
            path: string;
            uri: string;
        }
        export interface Package extends Base {
            eType: 'package';
            /** undefined when status === 'unlink' */
            options?: PackageJson;
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
        // TODO: when the package.json changes or is removed, we should send 'unlink' events for every file that was previously added?
        // TODO: deleting files breaks this

        const eventsSubject = new Subject<Event>();

        let templatesWatcher: Watcher<Event> | undefined;
        let partialsWatcher: Watcher<Event> | undefined;
        const pluginPath = Path.join(searchPath, name);
        //
        // read the directory to make sure it's there and give better error message
        // return from(fs.readdir(pluginPath)).pipe(
        // );
        const packagePath = Path.join(pluginPath, 'package.json');
        const packageWatcher = watchFiles(packagePath);
        // watch package.json
        packageWatcher.events.pipe(
            filter((watchEvent) =>
                watchEvent.eType === 'add'
                || watchEvent.eType === 'change'
                || watchEvent.eType === 'unlink'
            ),
            mergeMap((watchEvent) => {
                if(watchEvent.eType === 'unlink' || watchEvent.eType === 'change') {
                    if(templatesWatcher) {
                        templatesWatcher.close();
                        templatesWatcher = undefined;
                    }
                    if(partialsWatcher) {
                        partialsWatcher.close();
                        partialsWatcher = undefined;
                    }
                }

                let packageContentsObservable: Observable<string | undefined> = of(undefined);

                if(watchEvent.eType === 'add' || watchEvent.eType === 'change') {
                    packageContentsObservable = from(fs.readFile(watchEvent.path, 'utf-8'));
                }

                return forkJoin(
                    of(watchEvent),
                    packageContentsObservable,
                );
            }),
            map(([watchEvent, contents]) => {
                let options: PackageJson | undefined;
                if(contents) {
                    // TODO: centralize options initialization logic in load()
                    try {
                        const packageJson = JSON.parse(contents);
                        if(typeof packageJson !== 'object') {
                            throw new Error(`Plugin package.json must be an object, but it was '${typeof packageJson}' instead`);
                        }

                        if(!packageJson.freshr) {
                            packageJson.freshr = {};
                        }

                        packageJson.freshr = {
                            ...packageJson.freshr,
                            basePath: packageJson.freshr.basePath || '.',
                            templates: packageJson.freshr.templates || ['templates'],
                            partials: packageJson.freshr.partials || ['partials'],
                            components: packageJson.freshr.components || ['components'],
                            site: packageJson.freshr.site || ['site']
                        };

                        if(packageJson.freshr.hypermedia) {
                            packageJson.freshr.hypermedia = {
                                baseUrl: '/',
                                templatePaths: [],
                                ...packageJson.freshr.hypermedia
                            }
                        }


                        options = packageJson;
                    }
                    catch(error) {
                        eventsSubject.next({
                            eType: 'error',
                            error: error as Error,
                        });
                    }
                }

                eventsSubject.next({
                    eType: 'package',
                    status: watchEvent.eType as 'add' | 'change' | 'unlink', // cast is safe thanks to filter above 
                    path: watchEvent.path,
                    uri: watchEvent.uri,
                    options
                });

                // watch templates and partials
                if(options) {
                    const templatesPaths = options.freshr.templates.map(
                        (templatesPath: string) => Path.join(
                            pluginPath,
                            options!.freshr.basePath,
                            templatesPath)
                    );

                    const originalTemplatesWatcher = watchFiles(templatesPaths);
                    templatesWatcher = {
                        close: originalTemplatesWatcher.close,
                        events: originalTemplatesWatcher.events.pipe(
                            filter((templateWatchEvent) =>
                                templateWatchEvent.eType === 'add'
                                || templateWatchEvent.eType === 'change'
                                || templateWatchEvent.eType === 'unlink'
                            ),
                            mergeMap((templateWatchEvent) => {
                                return forkJoin(
                                    of(templateWatchEvent),
                                    from(fs.readFile(templateWatchEvent.path, 'utf-8'))
                                );
                            }),
                            map(([templateWatchEvent, contents]) => {
                                return {
                                    eType: 'template',
                                    status: templateWatchEvent.eType as 'add' | 'change' | 'unlink',
                                    path: templateWatchEvent.path,
                                    uri: templateWatchEvent.uri,
                                    contents,
                                };
                            })
                        ),
                    };
                    templatesWatcher.events.subscribe((event) => eventsSubject.next(event));

                    const partialsPaths = options.freshr.partials.map(
                        (partialsPath: string) => Path.join(
                            pluginPath,
                            options!.freshr.basePath,
                            partialsPath)
                    );

                    const originalPartialsWatcher = watchFiles(partialsPaths);
                    partialsWatcher = {
                        close: originalPartialsWatcher.close,
                        events: originalPartialsWatcher.events.pipe(
                            filter((partialWatchEvent) =>
                                partialWatchEvent.eType === 'add'
                                || partialWatchEvent.eType === 'change'
                                || partialWatchEvent.eType === 'unlink'
                            ),
                            mergeMap((partialWatchEvent) => {
                                return forkJoin(
                                    of(partialWatchEvent),
                                    from(fs.readFile(partialWatchEvent.path, 'utf-8'))
                                );
                            }),
                            map(([partialWatchEvent, contents]) => {
                                return {
                                    eType: 'partial',
                                    status: partialWatchEvent.eType as 'add' | 'change' | 'unlink',
                                    path: partialWatchEvent.path,
                                    uri: partialWatchEvent.uri,
                                    contents,
                                };
                            })
                        ),
                    };
                    partialsWatcher.events.subscribe((event) => eventsSubject.next(event));
                }
            })
        ).subscribe();

        return {
            close: () => {
                packageWatcher.close()
                if(templatesWatcher) {
                    templatesWatcher.close();
                }

                if(partialsWatcher) {
                    partialsWatcher.close();
                }

                eventsSubject.complete();
            },
            events: eventsSubject,
        };
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
                            basePath: obj.freshr.basePath || '.',
                            templates: obj.freshr.templates || ['templates'],
                            partials: obj.freshr.partials || ['partials'],
                            components: obj.freshr.components || ['components'],
                            site: obj.freshr.site || ['site']
                        };

                        if(obj.freshr.hypermedia) {
                            obj.freshr.hypermedia = {
                                baseUrl: '/',
                                templatePaths: [],
                                ...obj.freshr.hypermedia
                            }
                        }

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
                        packageOptions.freshr.basePath,
                        templatesPath)
                );
                const partialsPaths = packageOptions.freshr.partials.map(
                    (partialsPath: string) => Path.join(
                        pluginPath,
                        packageOptions.freshr.basePath,
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
                                path: pluginPath,
                                packageOptions: packageOptions.freshr,
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
        basePath: string;
        /** list of paths (relative to basePath) to directories or files containing templates. default ['templates'] */
        templates: string[];
        /** list of paths (relative to basePath) to directories or files containing partials. default ['partials'] */
        partials: string[];
        /** list of paths (relative to basePath) to directories or files containing javascript components. default ['components'] */
        components: string[];
        /** list of paths (relative to basePath) to directories or files containing HAL resources that should be served. only used if hypermedia option is set. default ['site'] */
        site: string[];
        /** if defined, resources will be served by the hypermedia server based on these settings. this allows self-contained modules to be easily added to a site (e.g. a forum-subsite). default undefined */
        hypermedia?: PackageOptions.Hypermedia;
    }

    export namespace PackageOptions {
        export interface Hypermedia {
            /** default base URL that all resources, assets, and APIs should be served at. default '/' */
            baseUrl: string;
            /** templates that should be used for resources served from this plugin. routerPath is relative to baseUrl, and should start with a slash ('/') or be empty (only plugin files are affected, unless baseUrl is the root or collides with other resources). templateUri is absolute. default [] */
            templatePaths: TemplatePath[];
        }
    }

    /** Server assets like processors and API implementations are shared by exporting
     * an object with the following properties in their "main" module (uses package.json "main" property, or index.js) */
    export interface Module {
        processorGenerators?: {[name: string]: ProcessorGenerator};
        websocketMiddleware?: WebsocketMiddleware;

        profileLayouts?: ProfileLayoutMap;

        taskDefinitions?: TaskDefinition[];

        /** These build steps are performed while registering the plugin */
        buildSteps?: BuildStep;
    }

    export namespace Module {
        export type Factory = (options: PackageOptions, freshr: Freshr) => Module;
    }

    export type ProcessorGenerator = (options?: any) => Processor;
}
