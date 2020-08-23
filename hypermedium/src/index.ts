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

// export * as Util from './util';

import * as Path from 'path';
import { from } from 'rxjs';
import { Log } from 'freshlog';
import { mergeMap, map } from 'rxjs/operators';
import * as Express from 'express';

import { Hypermedium } from './hypermedium';
import { HypermediaEngine } from './hypermedia-engine';
import * as Build from './build';
import { Module } from './plugin';


import { PluginManager } from './plugin-manager';

import { server } from './server';

// import * as Minimist from 'minimist';

/** freshr may be used as a library or a script */
if(require.main === module) {
    Log.handlers.get('trace')!.enabled = true;

    // run as a script
    // const commandLine = Minimist(process.argv.slice(2));
    const demoPath = Path.join(__dirname, '..', '..', 'hypermedium-demo');
    const corePath = Path.join(__dirname, '..', '..', 'hypermedium-core');

    // initialize freshr
    const hypermedium = new Hypermedium();

    hypermedium.hypermedia.event$.subscribe({
        next: (event) => {
            switch(event.eType) {
                case 'Warning':
                    Log.warn(event.message);
                    break;
                default: {
                    const e: Partial<HypermediaEngine.Event> = Object.assign({}, event);
                    if(e.eType === 'ProcessResource') {
                        delete e.edges;
                        delete e.resource;
                    }
                    if((e as any).relativeUri) {
                        Log.trace(`hypermedia-engine: ${event.eType} ${(e as any).relativeUri}`, e);
                    }
                    else {
                        Log.trace(`hypermedia-engine: ${event.eType}`, e);
                    }
                }
            }
        }
    });

    // temporary: test plugin loading
    const demoPlugin = hypermedium.pluginManager.loadPlugin(demoPath);
    const corePlugin = hypermedium.pluginManager.loadPlugin(corePath);

    // TODO: wait until 'initialized' event before loading next plugin
    from([corePlugin, demoPlugin]).pipe(
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
                Log.info(`${moduleInstance.name}: ${event.fileEvent} HAL resource: ${event.uri}`, {event, moduleInstance});
            }
            else {
                Log.trace(`${moduleInstance.name}: ${event.eType}: ${(event as any).name || (event as any).uri || (event as any).profile || ''}`, {event, moduleInstance});
            }
        },
        error: (error) => {
            Log.error(error.message, {error});
        }
    });

    // set up the http server
    const app = Express();
    app.use(hypermedium.renderer.router);
    app.use(hypermedium.hypermedia.router);

    server(app).subscribe({
        next: (server) => {
            Log.info('server-listening', {port: server.port});
        }, 
        error: (error) => Log.error('server-start', {error}),
    });


    // generate a static site
}

interface FreshrCmdOptions {
    /** list of paths that will be used as a base directory for plugin lookups */
    pluginsPaths: string[];
    /** list of plugins to load. will be searched for in pluginsPaths */
    pluginNames: string[];
    /** context used in HTML templating */
    siteContext: any;
}
