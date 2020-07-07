export * from './server';
export * from './hypermedia';
export * from './hypermedia/processor';
export * from './hypermedia-renderer';
export * from './build';
export * from './plugin';
export * from './freshr';
export * from './util';
export * from './hal-util';

import * as HAL from './hal';
export {HAL};

import { Freshr } from './freshr';
import * as Path from 'path';
import { mergeMap, map } from 'rxjs/operators';

import { PluginManager } from './plugin';

// import * as Minimist from 'minimist';

/** freshr may be used as a library or a script */
if(require.main === module) {
    // run as a script
    // const commandLine = Minimist(process.argv.slice(2));
    const demoPath = Path.join(__dirname, '..', '..', '..', 'demo2');

    // initialize freshr
    const freshr = new Freshr();

    // temporary: test plugin loading
    const pluginManager = new PluginManager();
    const demoPlugin = pluginManager.loadPlugin(demoPath);
    pluginManager.createModule(demoPlugin.plugin.name, demoPlugin.plugin.name, {}).pipe(
        mergeMap((moduleInstance) => {
            return freshr.registerModule(moduleInstance);
        })
    ).subscribe({
        next: () => {
        },
        error: (error) => {
        }
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
