/** core types and libraries */
export * as Build from './build';
export * as Hal from './hal';
export * from './plugin';

/** core utilities */
export * from './hypermedium';
export * from './hypermedia-engine';
export * from './renderer';
export * from './plugin-manager';
export * as Server from './server';
export * as HalUtil from './hal-util';
export * as Util from './util';

import * as Path from 'path';
import { from } from 'rxjs';
import { Log } from 'freshlog';
import { mergeMap, map } from 'rxjs/operators';
import * as Express from 'express';

import { Hypermedium } from './hypermedium';
import * as HypermediaEngine from './hypermedia-engine';
import * as Build from './build';
import { Module } from './plugin';


import { PluginManager } from './plugin-manager';

import { server } from './server';

import * as Minimist from 'minimist';

/** hypermedium may be used as a library or a script */
if(require.main === module) {
    HypermediumCmd(process.argv.slice(2));
}

export function HypermediumCmd(argv: string[]) {
    Log.handlers.get('trace')!.enabled = true;

    const args = Minimist(argv);

    const commands = [{
        flags: ['h', 'help'],
        fn: (args: Minimist.ParsedArgs) => {
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
        argName: 'OUTPUT_DIR',
        unamedArgs: '<plugin(s)>',
        options: true,
        fn: (args: Minimist.ParsedArgs) => {
            return 0;
        }
    }, {
        flags: ['S', 'server'],
        unamedArgs: '<plugin(s)>',
        options: true,
        fn: (args: Minimist.ParsedArgs) => {
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
                        path: parts[0],
                        uri: '/',
                    };
                }
                else if(parts.length === 2) {
                    return {
                        path: parts[0],
                        uri: parts[1],
                    };
                }

                throw new Error(`Invalid static mapping: ${mapping}`);
            });

            initializeHypermedium(staticMappings);
            // return 0;
        }
    }];

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

    const flags = Object.keys(args);
    for(let command of commands) {
        if(command.flags.some((flag) => flags.includes(flag))) {
            const code = command.fn(args);
            if(code != null) {
                process.exit(code);
            }
            return;
        }
    }

    // no command specified: default command
    const code = commands[0].fn(args);
    if(code != null) {
        process.exit(code);
    }
}

// temp function
function initializeHypermedium(staticMappings: StaticMapping[]) {
    // const commandLine = Minimist(process.argv.slice(2));
    const demoPath = Path.join(__dirname, '..', '..', 'hypermedium-demo');
    const corePath = Path.join(__dirname, '..', '..', 'hypermedium-core');
    const sassPath = Path.join(__dirname, '..', '..', 'hypermedium-sass');
    const markdownPath = Path.join(__dirname, '..', '..', 'hypermedium-markdown');

    // initialize hypermedium
    const hypermedium = new Hypermedium();

    hypermedium.hypermedia.events.subscribe({
        next: (event) => {
            switch(event.eType) {
                case 'Warning':
                    Log.warn(event.message, event.data);
                    break;
                default: {
                    const e: Partial<HypermediaEngine.Event> = Object.assign({}, event);
                    if(e.eType === 'ProcessorLog') {
                        Log.log(e.log.level, e.log.message, e.log);
                        return;
                    }
                    if(e.eType === 'ProcessResource') {
                        delete e.edges;
                        delete e.resource;
                    }
                    if((e as any).uri) {
                        if(event.eType === 'ProcessorError') {
                            Log.error(`hypermedia-engine: ${event.eType} ${(e as any).uri}: ${event.error.message}`, e);
                        }
                        else if(event.eType === 'LoadResource') {
                            Log.info(`hypermedia-engine: ${event.eType} ${(e as any).uri}`, e);
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
                    Log.info(`html-renderer ${event.eType}: ${event.uri}`, {...event});
            }
        }
    });

    hypermedium.build.watchEvents.subscribe({
        next: (event) => {
            logBuildEvent({eCategory: 'build-event', ...event});
        },
    });

    // temporary: test plugin loading
    const demoPlugin = hypermedium.pluginManager.loadPlugin(demoPath);
    const corePlugin = hypermedium.pluginManager.loadPlugin(corePath);
    const sassPlugin = hypermedium.pluginManager.loadPlugin(sassPath);
    const markdownPlugin = hypermedium.pluginManager.loadPlugin(markdownPath);

    // TODO: wait until 'initialized' event before loading next plugin
    from([corePlugin, sassPlugin, markdownPlugin, demoPlugin]).pipe(
        mergeMap((plugin) => {
            return hypermedium.pluginManager.createModule(plugin.plugin.name, plugin.plugin.name, {}).pipe(
                mergeMap((moduleInstance) => {
                    Log.info(`Create module: ${moduleInstance.name}`, moduleInstance);
                    if(moduleInstance.name === demoPlugin.plugin.name || corePlugin.plugin.name) {
                        // don't namespace the user plugin or core plugin
                        // TODO: we should probably actually leave the core prefix?
                        // TODO: look into overriding namespaces. it would be nice if you could use e.g. core/layout/default.hbs but override with your own includes/header.hbs, etc. right now the override probably doesn't work and if it does it probably shows the most recently edited file
                        return hypermedium.registerModule(moduleInstance, '').pipe(
                            map((event) => ({moduleInstance, event}))
                        );
                    }

                    return hypermedium.registerModule(moduleInstance).pipe(
                        map((event) => ({moduleInstance, event}))
                    );
                }),
            );
        })
    ).subscribe({
        next: ({moduleInstance, event}) => {
            if(event.eType === 'resource-changed') {
                Log.info(`${moduleInstance.name}: ${event.fileEvent} HAL resource: ${event.uri}`, {event, moduleInstance: {name: moduleInstance.name, modulePath: moduleInstance.modulePath}});
            }
            else if(event.eCategory === 'build-event') {
                logBuildEvent(event, moduleInstance);
            }
            else {
                Log.trace(`${moduleInstance.name}: ${event.eType}: ${(event as any).name || (event as any).uri || (event as any).profile || ''}`, {event, moduleInstance: {name: moduleInstance.name, modulePath: moduleInstance.modulePath}});
            }
        },
        error: (error) => {
            Log.error(error.message, {error});
        }
    });

    // set up the http server
    const app = Express();

    staticMappings.forEach((mapping) => {
        app.use(mapping.uri, Express.static(mapping.path));
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

    server(app).subscribe({
        next: (server) => {
            Log.info('server-listening', {port: server.port});
        }, 
        error: (error) => Log.error('server-start', {error}),
    });


    // generate a static site
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
    path: string;
    uri: string;
}

function logBuildEvent(event: Build.Event & {eCategory: 'build-event'}, moduleInstance?: Module.Instance) {
    // TODO: print nicer, use correct log levels
    const message = event.eType === 'log'?
        ' ' + event.log.message:
        event.eType === 'error'?
        ' ' + event.error.message:
        '';
    if(moduleInstance) {
        Log.trace(`${moduleInstance.name}: ${event.eCategory} ${event.eType}${message}`, {event, moduleInstance: {name: moduleInstance.name, modulePath: moduleInstance.modulePath}});
    }
    else {
        Log.trace(`${event.eCategory} watch: ${event.eType}${message}`, {event});
    }
}
