/** core types and libraries */
export * as Build from './build';
export * as JsonLD from './json-ld';
export * from './plugin';

/** core utilities */
export * from './hypermedium';
export * from './hypermedia-engine';
export * from './renderer';
export * from './plugin-manager';
export * as Server from './server';
export * as JsonLDUtil from './json-ld-util';
export * as Util from './util';

import * as Path from 'path';
import { Log } from 'freshlog';
import { concat, defer, EMPTY, merge, Observable } from 'rxjs';
import { timeoutWith, tap, catchError, toArray, map, mergeMap, filter } from 'rxjs/operators';
import * as Express from 'express';

import { Hypermedium } from './hypermedium';
import * as HypermediaEngine from './hypermedia-engine';
import * as Build from './build';
import { Module } from './plugin';

import { server, Server } from './server';

import * as Minimist from 'minimist';

/** hypermedium may be used as a library or a script */
if(require.main === module) {
    HypermediumCmd(process.argv.slice(2));
}

export interface HypermediumCommand {
    flags: string[];
    argName?: string;
    unamedArgs?: string;
    options?: boolean;
    fn: (args: Minimist.ParsedArgs) => Promise<number | void>;
}

export async function HypermediumCmd(argv: string[]) {
    Log.handlers.get('trace')!.enabled = true;

    const args = Minimist(argv, {
        alias: {output: 'O', server: 'S', force: 'f'},
        // NOTE: using boolean default initializes all the flags to false, which isn't necessarily what we want?
        boolean: ['O', 'output', 'S', 'server', 'f', 'force'],
    });

    // NOTE: hypermedium does not use node package resolution, and it will not automatically search for the packages in parent directories.
    // if you are relying on the package resolution for multi-project workspaces, you must specify the plugin search paths explicitly.
    // that functionality is not yet implemented, for the demo to work we always search the parent node_modules
    const defaultPluginSearchPaths = [
        Path.join(process.cwd(), 'node_modules', '@hypermedium'),
        process.cwd(),
        Path.join(process.cwd(), '..', 'node_modules', '@hypermedium'),
    ];

    const commands: HypermediumCommand[] = [{
        flags: ['h', 'help'],
        fn: async (args: Minimist.ParsedArgs) => {
            const execName = 'hypermedium';
            const usageStrings = commands.map((command) => {
                const flags = command.flags.map((flag) => (flag.length > 1? '--': '-') + flag).join(' ');
                const flagArg = command.argName? ' ' + command.argName: '';
                const unamedArgs = command.unamedArgs? (' ' + command.unamedArgs):'';
                const options = command.options? ' [options]': '';
                return `   ${execName} {${flags}}${flagArg}${options}${unamedArgs}`;
            });

            console.error(`usage: ${execName} <command> [...]`);
            console.error(usageStrings.join('\n'));
            return 1;
        }
    }, {
        flags: ['O', 'output'],
        // argName: 'OUTPUT_DIR',
        unamedArgs: '<plugin(s)>',
        options: true,
        fn: async (args: Minimist.ParsedArgs) => {
            // export static files after initialization, then exit
            Log.info(`command line arguments: ${process.argv.slice(2).join(' ')}`, {args});
            // TODO: should we use the output argument as the export path?

            const hypermedium = await initializeHypermedium({
                plugins: args._,
                pluginSearchPaths: defaultPluginSearchPaths,
            });

            await exportSite(hypermedium, {
                overwrite: args.force || args.f
            });

            return 0;
        }
    }, {
        flags: ['S', 'server'],
        unamedArgs: '<plugin(s)>',
        options: true,
        fn: async (args: Minimist.ParsedArgs) => {
            Log.info(`command line arguments: ${process.argv.slice(2).join(' ')}`, {args});
            // TODO: get list of plugins, plugin-lookup dirs (e.g. node_modules)
            // const hypermedium = new Hypermedium();
            let staticMappingStrs: string | string[] = args['s'] || args['static'] || [];
            if(!Array.isArray(staticMappingStrs)) {
                staticMappingStrs = [staticMappingStrs];
            }

            const staticMappings = staticMappingStrs.map((mapping) => {
                const parts = mapping.split(':');
                if(parts.length === 1) {
                    return {
                        from: parts[0],
                        to: '/',
                    };
                }
                else if(parts.length === 2) {
                    return {
                        from: parts[0],
                        to: parts[1],
                    };
                }

                throw new Error(`Invalid static mapping: ${mapping}`);
            });

            //TODO: automatically get the first part of the plugins list (the flagged part) from the flags arg. maybe use minimist opts.boolean?

            const hypermedium = await initializeHypermedium({
                plugins: args._,
                pluginSearchPaths: defaultPluginSearchPaths,
            });

            const app = await runHttpServer(hypermedium, {
                port: args['p'] ?? args['port'] ?? 3000,
                staticMappings
            });
        }
    }];

    /*
    const options = [{
        flags: ['p', 'pluginDir'],
        // commandsAllowed: [],
        description: 'Add this path to the list of directories to search when loading plugins.\nThis option may be specified multiple times.',
        defaultValue: ['.', 'node_modules'],
    }, {
        flags: ['s', 'static'],
        description: 'Format: <path>:<uri>\nMap the file or directory to a static uri in the output or server, If it is a directory, include all contents recursively.',
    }, {
        flags: ['m', 'main'],
        description: 'Designate the plugin as a "main" module. Main modules register their assets in the global namespace.\nIf this option is used, the plugin does not need to be specified in the main PLUGINS list.\nThis option may be specified multiple times.',
        defaultValue: ['core'],
    }, {
        flags: [''],
        description: ''
    }];
*/

    const flags = Object.keys(args);
    const command = commands.find(
        (command) => command.flags.some((flag) => flags.includes(flag) && args[flag] === true)
    ) || commands[0];

    try {
        const code = await command.fn(args);
        if(code != null) {
            process.exit(code);
        }
    }
    catch(error) {
        Log.error(error.message, {error, level: 'error'});
        process.exit(1);
    }
}

export interface HypermediumInitOptions {
    /** names of modules to be initialized. the first module will be used as the main module */
    plugins: string[];
    /** paths to plugin directories */
    pluginSearchPaths: string[];
}

export interface ExportOptions {
    /**  the export path. if not provided, defaults to 'mainPluginDir/export' */
    path?: string;
    /** if true, overwrite existing files */
    overwrite?: boolean;
}

export interface HttpServerOptions {
    /** port number if in server mode */
    port?: number;
    staticMappings: StaticMapping[];
}

async function initializeHypermedium(options: HypermediumInitOptions): Promise<Hypermedium> {
    if(options.plugins.length === 0) {
        throw new Error('Hypermedium must be initialized with at least one plugin');
    }

    const hypermedium = new Hypermedium();

    hypermedium.hypermedia.events.subscribe({
        next: (event) => {
            switch(event.eType) {
                case 'Warning':
                    Log.warn(event.message, event.data);
                    break;
                case 'Trace':
                    Log.trace(event.message, event.data);
                    break;
                default: {
                    const e: Partial<HypermediaEngine.Event> = Object.assign({}, event);
                    if(e.eType === 'ProcessorLog') {
                        Log.log(e.log.level, e.log.message, e.log);
                        return;
                    }
                    if(e.eType === 'DynamicResourceLog') {
                        Log.log(e.log.level, e.log.message, e.log);
                        return;
                    }
                    if(e.eType === 'DynamicResourceError') {
                        if(e.uri) {
                            Log.error(`hypermedia-engine: ${event.eType} ${e.dynamicResource!.name} ${e.uri}: ${e.error!.message}`, {error: e});
                        }
                        else {
                            Log.error(`hypermedia-engine: ${event.eType} ${e.dynamicResource!.name}: ${e.error!.message}`, {error: e});
                        }
                        return
                    }

                    if(e.eType === 'ProcessResource') {
                        delete e.edges;
                        delete e.resource;
                    }
                    if((e as any).uri) {
                        if(event.eType === 'ProcessorError') {
                            Log.error(`hypermedia-engine: ${event.eType} ${(e as any).uri}: ${event.error.message}`, {error: e});
                        }
                        else if(event.eType === 'LoadResource') {
                            Log.trace(`hypermedia-engine: ${event.eType} ${(e as any).uri}`, e);
                        }
                        else {
                            Log.trace(`hypermedia-engine: ${event.eType} ${(e as any).uri}`, e);
                        }
                    }
                    else {
                        Log.trace(`hypermedia-engine: ${event.eType}`, e);
                    }
                }
            }
        }
    });

    hypermedium.renderer.events.subscribe({
        next: (event) => {
            switch(event.eType) {
                case 'render-resource':
                    Log.trace(`html-renderer ${event.eType}: ${event.uri}`, {...event});
            }
        }
    });

    hypermedium.build.watchEvents.subscribe({
        next: (event) => {
            logBuildEvent({eCategory: 'build-event', ...event});
        },
    });

    // TODO: specify the main module explicitly
    const mainModule = options.plugins[0];

    const {modules, moduleEvents} = hypermedium.initializePlugins(options.plugins, options.pluginSearchPaths);

    moduleEvents.subscribe({
        next: ([event, module]) => {
            logModuleEvent(event, module);

            // if(module.name === demoPlugin.plugin.name || corePlugin.plugin.name) {
                // don't namespace the user plugin or core plugin
                // TODO: we should probably actually leave the core prefix?
                // TODO: look into overriding namespaces. it would be nice if you could use e.g. core/layout/default.hbs but override with your own includes/header.hbs, etc. right now the override probably doesn't work and if it does it probably shows the most recently edited file
                // return hypermedium.registerModule(module, '').pipe(
                    // map((event) => ({module, event}))
                // );
            // }
        },
        error: (error) => {
            Log.error(`Failed to load modules: ${error.message}`, {error});
            process.exit(1);
        }
    });

    return modules.pipe(
        tap((module) => {
            if(module.name === mainModule) {
                Log.info(`Module initialized (MAIN): ${module.name}`, module);
                hypermedium.mainModule = module;
            }
            else {
                Log.info(`Module initialized: ${module.name}`, module);
            }
        }),
        catchError((error) => {
            Log.error(`Failed to load modules: ${error.message}`, {error});
            throw error;
        }),
        toArray(),
        mergeMap((modules) => {
            Log.info(`${modules.length} modules initialized: ${modules.map((module) => module.name)}`);

            return hypermedium.hypermedia.processAllResources();

        }),
        tap(({uri, resource}) => {
            // TODO: this doesn't make sense here. will break when namespaces are used
            // TODO: making a big assumption that only the main module instance has context. this will break
            hypermedium.updateContext(hypermedium.mainModule!, '', uri);
        }),
        toArray(),
        map((nodes) => {
            Log.info(`Setup complete: ${nodes.length} resources processed`);
            return hypermedium;
        })
    ).toPromise();

    // return hypermedium.initializePlugins(options.plugins, options.pluginSearchPaths).pipe(
    //     tap(({module, event}) => {
    //         logModuleEvent(event, module);

    //         // if(module.name === demoPlugin.plugin.name || corePlugin.plugin.name) {
    //             // don't namespace the user plugin or core plugin
    //             // TODO: we should probably actually leave the core prefix?
    //             // TODO: look into overriding namespaces. it would be nice if you could use e.g. core/layout/default.hbs but override with your own includes/header.hbs, etc. right now the override probably doesn't work and if it does it probably shows the most recently edited file
    //             // return hypermedium.registerModule(module, '').pipe(
    //                 // map((event) => ({module, event}))
    //             // );
    //         // }
    //     }),
    //     filter(({event}) => event.eCategory === 'module' && event.eType === 'initialized'),
    //     map(({module}) => module),
    //     tap((module) => {
    //         if(module.name === mainModule) {
    //             Log.info(`Module initialized (MAIN): ${module.name}`, module);
    //             hypermedium.mainModule = module;
    //         }
    //         else {
    //             Log.info(`Module initialized: ${module.name}`, module);
    //         }
    //     }),
    //     catchError((error) => {
    //         Log.error(`Failed to load modules: ${error.message}`, {error});
    //         throw error;
    //     }),
    //     toArray(),
    //     mergeMap((modules) => {
    //         Log.info(`${modules.length} modules initialized: ${modules.map((module) => module.name)}`);

    //         return hypermedium.hypermedia.processAllResources();
    //     }),
    //     toArray(),
    //     map((nodes) => {
    //         Log.info(`Setup complete: ${nodes.length} resources processed`);
    //         return hypermedium;
    //     })
    // ).toPromise();
}

async function exportSite(hypermedium: Hypermedium, options: ExportOptions) {
    const exportPath = options.path || Path.join(hypermedium.mainModule?.modulePath || process.cwd(), 'export');
    Log.info(`exporting site to ${exportPath}`, {exportPath});

    return hypermedium.exportSite(exportPath, {overwrite: options.overwrite}).pipe(
        tap((event: Hypermedium.Event.Export | HypermediaEngine.Event.Warning | HypermediaEngine.Event.Trace) => {
            switch(event.eType) {
                case 'Export':
                    Log.trace(`export ${event.from} -> ${event.path}`, event);
                    break;
                case 'Warning':
                    Log.warn(event.message, event);
                    break;
                case 'Trace':
                    Log.trace(event.message, event);
                    break;
            }
        })
    ).toPromise();
}

async function runHttpServer(hypermedium: Hypermedium, options: HttpServerOptions): Promise<Express.Express> {
    const app = Express();

    // TODO: specify which modules to map
    if(hypermedium.mainModule?.module.files) {
        hypermedium.mainModule.module.files.forEach((file) => {
            const mapping = typeof file === 'string'?
                {from: file, to: '/'}:
                file;

            const fromPath = Path.join(hypermedium.mainModule!.modulePath, mapping.from);
            Log.trace(`Server: add static mapping '${fromPath}' -> '${mapping.to}'`, {from: fromPath, to: mapping.to});
            app.use(mapping.to, Express.static(fromPath));
        });
    }

    options.staticMappings.forEach((mapping) => {
        Log.trace(`Server: add static mapping '${mapping.from}' -> '${mapping.to}'`, mapping);
        app.use(mapping.to, Express.static(mapping.from));
    });

    app.use(hypermedium.renderer.router);
    app.use(hypermedium.hypermedia.router);

    app.use((error: any, req: Express.Request, res: Express.Response, next: Express.NextFunction) => {
        const errorOut = {
            code: error.httpCode || 500,
            data: Object.keys(error).reduce((o: any, p: string) => {
                o[p] = error[p];
                return o;
            }, {}),
            message: error.message,
        };

        if(errorOut.code >= 500) {
            Log.error(`MiddlewareError ${req.url}: ${error.constructor.name}: ${error.message}`, {
                uri: req.url,
                error,
            });
        }
        res.status(errorOut.code).json(errorOut);
    });

    // const serverOptions: Partial<Server.Options> = {};
    // if(options.port !== undefined) {
    //     serverOptions.port = options.port;
    // }

    // return server(app, serverOptions).toPromise();

    return new Promise((resolve) => {
        const server = app.listen(options.port, () => {
            const port = (server.address() as any).port;
            Log.info(`server-listening at port ${port}`, {port});
            resolve(app);
        });
    });
}



interface HypermediumCmdOptions {
    /** list of paths that will be used as a base directory for plugin lookups */
    pluginsPaths: string[];
    /** list of plugins to load. will be searched for in pluginsPaths */
    pluginNames: string[];
    /** context used in HTML templating */
    siteContext: any;
}

interface StaticMapping {
    from: string;
    to: string;
}

function logModuleEvent(event: Module.Event | ({eCategory: 'build-event'} & Build.Event), moduleInstance: Module.Instance) {
    if(event.eType === 'error') {
        Log.error(`${moduleInstance.name}: ${(event as any).uri || ''} ${event.error.message}`, {event, moduleInstance: {name: moduleInstance.name, modulePath: moduleInstance.modulePath, error: event.error}});
    }
    else if(event.eType === 'resource-changed') {
        Log.info(`${moduleInstance.name}: ${event.fileEvent} hypermedia resource: ${event.uri}`, {event, moduleInstance: {name: moduleInstance.name, modulePath: moduleInstance.modulePath}});
    }
    else if(event.eType === 'template-changed') {
        Log.info(`${moduleInstance.name}: ${event.fileEvent} template: ${event.uri}`, {event, moduleInstance: {name: moduleInstance.name, modulePath: moduleInstance.modulePath}});
    }
    else if(event.eType === 'partial-changed') {
        Log.info(`${moduleInstance.name}: ${event.fileEvent} partial: ${event.uri}`, {event, moduleInstance: {name: moduleInstance.name, modulePath: moduleInstance.modulePath}});
    }
    else if(event.eType === 'initialized') {
        Log.trace(`${moduleInstance.name}: ${event.eType}: ${moduleInstance.modulePath}`, {event, moduleInstance: {name: moduleInstance.name, modulePath: moduleInstance.modulePath}});
    }
    else if(event.eCategory === 'build-event') {
        logBuildEvent(event, moduleInstance);
    }
    else {
        const message = (event as any).name
            || (event as any).processorDefinition?.name
            || (event as any).processor?.name
            || (event as any).taskDefinition?.name
            || (event as any).uri
            || (event as any).profile
            || '';
        Log.trace(`${moduleInstance.name}: ${event.eType}: ${message}`, {event, moduleInstance: {name: moduleInstance.name, modulePath: moduleInstance.modulePath}});
    }
}

function logBuildEvent(event: Build.Event & {eCategory: 'build-event'}, moduleInstance?: Module.Instance) {
    // TODO: print nicer, use correct log levels
    // TODO: the build task logger automatically logs the input->output files for the step so is it redundant here? build manager should probably actually log once for each invocation instead of what it does now
    const message = event.eType === 'log'?
        ' ' + event.log.message:
        event.eType === 'error'?
        ' ' + event.error.message:
        '';

    let buildStepText = '';
    switch(event.buildStep.sType) {
        case 'task':
            buildStepText = event.buildStep.files.map(({inputs, outputs}) =>
                `${Object.values(inputs).flat().join(',')} -> ${Object.values(outputs).flat().join(',')}`
            ).join('; ');

            break;
        case 'multitask':
            const subStepNames = event.buildStep.steps.map((step) =>
                step.sType === 'task'? step.definition: step.steps.length + ' subtasks'
            ).join(',')

            buildStepText = `${event.buildStep.steps.length} subtasks (${event.buildStep.sync === true? 'serial': 'parallel'}): ${subStepNames}`
            break;
    }


    const moduleName = moduleInstance?.name || '';
    const taskName = event.buildStep.sType === 'task'? event.buildStep.definition: '';

    const text = `${moduleName} build ${taskName} ${event.eType}: ${message} (${buildStepText})`;

    if(event.eType === 'success') {
        Log.info(text, {event, moduleInstance: {name: moduleInstance?.name, modulePath: moduleInstance?.modulePath}});
    }
    else if(event.eType === 'error') {
        Log.error(text, {event, moduleInstance: {name: moduleInstance?.name, modulePath: moduleInstance?.modulePath}});
    }
    else {
        Log.trace(text, {event, moduleInstance: {name: moduleInstance?.name, modulePath: moduleInstance?.modulePath}});
    }
}
