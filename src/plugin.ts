import * as Path from 'path';
import { promises as fs } from 'fs';

import { Socket } from 'socket.io';
import { forkJoin, Observable, of, from } from 'rxjs';
import { toArray, map, mergeMap, catchError } from 'rxjs/operators';

import { Processor } from './hypermedia/processor';
import { PartialMap, ProfileLayoutMap, TemplateMap } from './hypermedia-renderer';
import { TaskDefinition } from './build';

import { File, loadFiles } from './util';

export interface Plugin {
    name: string;

    packageOptions: Plugin.PackageOptions;

    moduleFactory: Plugin.Module.Factory;

    partials?: File[],
    templates?: File[],
}

export namespace Plugin {
    export type WebsocketMiddleware = (socket: Socket, fn: (err?: any) => void) => void;

    /**
     * @param name - name of the plugin
     * @param searchPath - path to the directory we will search for 'name' in
     */
    export function load(name: string, searchPath: string): Observable<Plugin> {
        debugger;
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
                            templates: obj.freshr.templates || ['templates'],
                            partials: obj.freshr.partials || ['partials'],
                        };

                        return obj;
                    }),
                );
            }),
            mergeMap((packageOptions) => {
                const mainPath = Path.join(pluginPath, packageOptions.main || 'index.js');
                let moduleFactory: Module.Factory = () => ({});
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
                    (templatesPath: string) => Path.join(pluginPath, templatesPath));
                const partialsPaths = packageOptions.freshr.partials.map(
                    (partialsPath: string) => Path.join(pluginPath, partialsPath));

                return forkJoin(
                    of(moduleFactory),
                    loadFiles(templatesPaths).pipe(toArray()),
                    loadFiles(partialsPaths).pipe(toArray())
                ).pipe(
                    map(([moduleFactory, templates, partials]) => {
                        return {
                            name,
                            packageOptions,
                            moduleFactory,
                            partials,
                            templates,
                        };
                    })
                );
            })
        );
    }

    /** these options may be provided in the "package.json" as an object under the "freshr" property
     */
    export interface PackageOptions {
        /** list of paths (relative to package.json's dir) to directories or files containing templates. default 'templates' */
        templates: string[];
        /** list of paths (relative to package.json's dir) to directories or files containing partials. default 'partials' */
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

