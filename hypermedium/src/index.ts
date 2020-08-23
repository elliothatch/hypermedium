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

import { Log } from 'freshlog';

import { Hypermedium } from './hypermedium';
import * as Path from 'path';
import { from } from 'rxjs';
import { mergeMap, map } from 'rxjs/operators';

import { PluginManager } from './plugin-manager';

import { server } from './server';
import * as Express from 'express';

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

    // temporary: test plugin loading
    const demoPlugin = hypermedium.pluginManager.loadPlugin(demoPath);
    const corePlugin = hypermedium.pluginManager.loadPlugin(corePath);

    from([corePlugin, demoPlugin]).pipe(
        mergeMap((plugin) => {
            return hypermedium.pluginManager.createModule(plugin.plugin.name, plugin.plugin.name, {}).pipe(
                mergeMap((moduleInstance) => {
                    Log.trace(`created module instance '${moduleInstance.name}'`, moduleInstance);
                    if(moduleInstance.name === demoPlugin.plugin.name || corePlugin.plugin.name) {
                        // don't namespace the user plugin or core plugin
                        return hypermedium.registerModule(moduleInstance, '');
                    }

                    return hypermedium.registerModule(moduleInstance);
                }),
            );
        })
    ).subscribe({
        next: (event) => {
            if(event.eType === 'resource-changed') {
                Log.info(`${event.fileEvent} HAL resource: ${event.uri}`, event);
            }
            else {
                Log.trace(`${event.eType}: ${(event as any).name || (event as any).uri || (event as any).profile || ''}`, event);
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
