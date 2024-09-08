import * as Path from 'path';
import { validateData } from 'fresh-validation';
import * as fs from 'fs-extra';
import { Graph } from 'graphlib';
import { concat, defer, from, merge, of, Observable, partition } from 'rxjs';
import { concatMap, filter, map, takeWhile, publish } from 'rxjs/operators';

import { watchFiles, WatchEvent } from './util';
import { Processor } from './hypermedia-engine';

import { Plugin, Module } from './plugin';

export class PluginManager {
    /** each node is a PluginNode, edges point toward dependencies */
    public dependencyGraph: Graph;
    /** maps names to module instances */
    public modules: Map<string, Module.Instance>;

    constructor() {
        this.dependencyGraph = new Graph();
        this.dependencyGraph.setDefaultNodeLabel((_name: string) => ({}));

        this.modules = new Map();
    }

    // TODO: handle discrepancies between plugin directory name and name defined in plugin file

    /** recursively loads each plugin and its dependencies
     * Looks in each searchPath directory for a valid plugin file based on the criteria:
     *  - `main` property in a `package.json`
     *  - `index.js`
     * @searchPaths - a list of directories to search
    * @returns list of newly loaded plugins (not including plugins/dependencies that were already loaded) */
    public loadPluginsAndDependencies(pluginNames: string[], searchPaths: string[]): Plugin.File[] {
        const loadedPlugins: Plugin.File[] = [];
        pluginNames.forEach((pluginName) => {
            const node = this.dependencyGraph.node(pluginName);
            let pluginFile: Plugin.File | undefined = node?.pluginFile;
            if(!pluginFile) {
                pluginFile = this.findAndLoadPlugin(pluginName, searchPaths);
                loadedPlugins.push(pluginFile);
            }

            const dependencyNames = pluginFile.plugin.dependencies.map((dependency) => {
                return typeof dependency === 'string'?
                    dependency:
                    dependency.name;
            });
            const loadedDependencies = this.loadPluginsAndDependencies(dependencyNames, searchPaths);

            loadedPlugins.push(...loadedDependencies);
        });

        return loadedPlugins;
    }

    public findAndLoadPlugin(pluginName: string, searchPaths: string[]): Plugin.File {
        const loadErrors: LoadPluginError[] = [];
        // TODO: in verbose mode log paths that are searched
        for(const searchPath of searchPaths) {
            // TODO: the npm module names won't match the plugin names (because they'll be prefixed by 'hypermedium-'), maybe we should add that to default search path?
            const pluginPaths = [searchPath, Path.join(searchPath, pluginName)];
            for(const pluginPath of pluginPaths) {
                // first, check if there is a package.json. if there is, try to load the 'main' file.
                try {
                    let jsModule: any;
                    try {
                        const packageJson = fs.readJsonSync(Path.join(pluginPath, 'package.json'));
                        if(packageJson.main) {
                            jsModule = require(Path.join(pluginPath, packageJson.main));
                            jsModule = jsModule?.default || jsModule;
                        }
                    }
                    catch(err) {
                        loadErrors.push(new LoadPluginError(err.message, Path.join(pluginPath, 'package.json'), err));
                    }

                    // didn't work, this time just try the plugin directory itself (index.js)
                    // console.log(`try load: ${pluginPath}`);
                    try {
                        jsModule = require(pluginPath);
                        jsModule = jsModule?.default || jsModule;
                    }
                    catch(err) {
                        throw new LoadPluginError(err.message, pluginPath, err);
                    }

                    // try the load the plugin if the name matches our target
                    if(jsModule?.name === pluginName) {
                        const plugin = this.loadPlugin(pluginPath);
                        return plugin;
                    }
                }
                catch(error) {
                    loadErrors.push(error);
                }
            }
        }

        throw new AggregateError(loadErrors, `PluginManager.findAndLoadPlugin: failed to find valid plugin '${pluginName}'`);
    }

    /** loads a plugin file from disk and adds it to the dependency tree */
    public loadPlugin(pluginPath: string): Plugin.File {
        let jsModule: any;
        try {
            jsModule = require(pluginPath);
            if(!jsModule) {
                throw new LoadPluginError('no default export found', pluginPath);
            }

            jsModule = jsModule.default || jsModule;
        }
        catch(err) {
            throw new LoadPluginError(err.message, pluginPath, err);
        }

        let plugin: Plugin<any>;
        try {
            // NOTE: we don't use the return value of validateData because it strips properties that aren't whitelisted by @validate. we just want to check the types that we care about.
            validateData(jsModule, Plugin, 'default');
            plugin = jsModule;
        }
        catch(err) {
            throw new LoadPluginError(err.message, pluginPath, err);
        }

        // TODO: include version number in unique identifier for plugins
        const node = this.dependencyGraph.node(plugin.name);
        if(node && node.pluginFile) {
            throw new LoadPluginError(`The plugin '${plugin.name}' is already loaded (${node.pluginFile.path}). If you want to reload this plugin, unload it first with PluginManager.unloadPlugin('${plugin.name}')`, pluginPath);
        }

        const pluginNode: PluginManager.PluginNode = {
            pluginFile: {
                plugin,
                path: require.resolve(pluginPath),
            }
        };

        this.dependencyGraph.setNode(plugin.name, pluginNode);

        plugin.dependencies.forEach((dependency) => {
            const dependencyName = typeof dependency === 'string'? dependency: dependency.name;
            // console.log(`adding dependency: ${dependencyName} -> ${plugin.name}`);
            this.dependencyGraph.setEdge(dependencyName, plugin.name);
        });

        return pluginNode.pluginFile!;
    }

    /** @param name - unique identifier for the module. usually the same as plugin.name, unless this is an isolated instance */
    public createModule<T>(name: string, pluginName: string, options: Module.Options & T): Observable<Module.Instance> {
        return defer(() => {
            if(this.modules.has(name)) {
                throw new Error(`module '${name}' already exists`);
            }

            const pluginNode: PluginManager.PluginNode = this.dependencyGraph.node(pluginName);
            if(!pluginNode || !pluginNode.pluginFile) {
                throw new Error(`Failed to create module '${name}': plugin '${pluginName}' not loaded`);
            }

            // TODO: allow multiple modules of the same plugin to be initialized with different modules/instances of their dependencies (by adding 'dependencies' property to Module.Options)
            // currently, isolated instances cannot be used as dependencies

            const plugin = pluginNode.pluginFile.plugin;
            const missingPlugins = this.findMissingPlugins(plugin);
            if(missingPlugins.length > 0) {
                throw new Error(`Failed to create module '${name}': missing ${missingPlugins.length} plugin dependencies: ${missingPlugins}. Use PluginManager.loadPlugin to load the plugins first`);
            }

            const missingModules = this.findMissingModules(plugin);
            if(missingModules.length > 0) {
                throw new Error(`Failed to create module '${name}': missing ${missingModules.length} module dependencies ${missingModules}. Use PluginManager.createModule to initialize the modules first`);
            }

            // const modulePath = options.instancePath?
            // options.instancePath:
            // first '..' is to select the directory instead of the file
            const pluginDir = Path.join(pluginNode.pluginFile.path, '..', pluginNode.pluginFile.plugin.basePath || '');

            // TODO: handle directory already exists
            // do we somehow mark a directory as an "instance" directory (e.g. via a file) so we know it is probably safe to overwrite?
            return (!options.instancePath?
                of([pluginNode.pluginFile, pluginDir]):
                from(fs.copy(pluginDir, options.instancePath, {
                    overwrite: false,
                    errorOnExist: true,
                })).pipe(map(() => [pluginNode.pluginFile, options.instancePath]))
                ) as Observable<[Plugin.File, string]>;
        }).pipe(
            map(([pluginFile, modulePath]) => {
                const module = pluginFile.plugin.moduleFactory(options);
                // install event sources contain events that define constructs needed to initialize the rest of the module.
                // this includes creating processor factories, handlebars helpers, and task definitions
                const installEventSources: Array<Observable<Module.Event>> = [];
                const initializeEventSources: Array<Observable<Module.Event>> = [];
                const watchEventSources: Array<Observable<Module.Event>> = [];

                // every file watch increases the expected scanned events by one. when the events are encountered, the values is decremented, and at 0, the module initialized event is emitted
                // this method is kind of crude, but is simpler then trying to split the watch event streams into pre and post-ready observables without resubscribing to the watchFiles observable or missing events
                let expectedScannedEvents = 0;

                // set up watch events for the module
                if(module.hypermedia) {
                    if(module.hypermedia.sitePaths) {
                        const sitePaths = module.hypermedia.sitePaths.map((sitePath) => Path.join(modulePath, sitePath));
                        // hypermedia resources should always be absolute paths
                        // TODO: should hypermedia engine should deal with uri normalization?
                        const baseUri = module.hypermedia.baseUri != null?
                            module.hypermedia.baseUri:
                            '/';

                        let scanComplete = false;
                        watchEventSources.push(watchFiles(sitePaths, baseUri).pipe(
                            filter((watchEvent) => ['add', 'change', 'unlink', 'ready'].includes(watchEvent.eType)),
                            map((watchEvent) => {
                                if(watchEvent.eType === 'ready') {
                                    scanComplete = true;
                                    return {
                                        eCategory: 'hypermedia',
                                        eType: 'resources-scanned',
                                    } satisfies Module.Event.Hypermedia.ResourcesScanned;
                                }

                                return {
                                    eCategory: 'hypermedia',
                                    eType: 'resource-changed',
                                    fileEvent: watchEvent.eType as 'add' | 'change' | 'unlink',
                                    path: (watchEvent as WatchEvent.File).path,
                                    uri: (watchEvent as WatchEvent.File).uri,
                                    initialScan: !scanComplete,
                                } satisfies Module.Event.Hypermedia.ResourceChanged;
                            })
                        ));

                        expectedScannedEvents++;
                    }

                    if(module.hypermedia.processorDefinitions) {
                        const processorDefinitionEvents = module.hypermedia.processorDefinitions.map((processorDefinition) => ({
                            eCategory: 'hypermedia' as const,
                            eType: 'processor-definition-changed' as const,
                            processorDefinition
                        }));
                        installEventSources.push(from(processorDefinitionEvents));
                    }

                    if(module.hypermedia.processors) {
                        // TODO: is this a race condition with processorDefinitions?

                        const processorEvents = Object.keys(module.hypermedia.processors).reduce((arr: {processor: Processor, stage: string}[], stage) => {
                            return arr.concat(module.hypermedia!.processors![stage].map((processor) => ({processor, stage})));
                        }, []).map(({processor, stage}) => ({
                            eCategory: 'hypermedia' as const,
                            eType: 'processor-changed' as const,
                            processor,
                            stage
                        }));
                        initializeEventSources.push(from(processorEvents));
                    }

                    if(module.hypermedia.dynamicResourceDefinitions) {
                        const dynamicResourceDefinitionEvents = module.hypermedia.dynamicResourceDefinitions.map((dynamicResourceDefinition) => ({
                            eCategory: 'hypermedia' as const,
                            eType: 'dynamic-resource-definition-changed' as const,
                            dynamicResourceDefinition
                        }));
                        installEventSources.push(from(dynamicResourceDefinitionEvents));
                    }

                    if(module.hypermedia.dynamicResources) {
                        // TODO: is this a race condition with dynamicResourceDefinitions?

                        const dynamicResourceEvents = module.hypermedia.dynamicResources.map((dynamicResource) => ({
                            eCategory: 'hypermedia' as const,
                            eType: 'dynamic-resource-changed' as const,
                            dynamicResource,
                        }));
                        initializeEventSources.push(from(dynamicResourceEvents));
                    }

                }

                if(module.renderer) {
                    if(module.renderer.templatePaths) {
                        const templatePaths = module.renderer.templatePaths.map((templatePath) => Path.join(modulePath, templatePath));

                        let scanComplete = false;
                        watchEventSources.push(watchFiles(templatePaths).pipe(
                            filter((watchEvent) => ['add', 'change', 'unlink', 'ready'].includes(watchEvent.eType)),
                            map((watchEvent) => {
                                if(watchEvent.eType === 'ready') {
                                    scanComplete = true;
                                    return {
                                        eCategory: 'renderer',
                                        eType: 'templates-scanned',
                                    } satisfies Module.Event.Renderer.TemplatesScanned;
                                }

                                return {
                                    eCategory: 'renderer',
                                    eType: 'template-changed',
                                    fileEvent: watchEvent.eType as 'add' | 'change' | 'unlink',
                                    path: (watchEvent as WatchEvent.File).path,
                                    uri: (watchEvent as WatchEvent.File).uri,
                                    initialScan: !scanComplete,
                                } satisfies Module.Event.Renderer.TemplateChanged;
                            })
                        ));

                        expectedScannedEvents++;
                    }

                    if(module.renderer.templateRoutes) {
                        const templateRouteEvents = module.renderer.templateRoutes.map((templateRoute) => ({
                            eCategory: 'renderer' as const,
                            eType: 'template-route-added' as const,
                            routerPattern: templateRoute.routerPattern,
                            templateUri: templateRoute.templateUri
                        }));
                        installEventSources.push(from(templateRouteEvents));
                    }

                    if(module.renderer.partialPaths) {
                        const partialPaths = module.renderer.partialPaths.map((partialPath) => Path.join(modulePath, partialPath));

                        let scanComplete = false;
                        watchEventSources.push(watchFiles(partialPaths).pipe(
                            filter((watchEvent) => ['add', 'change', 'unlink', 'ready'].includes(watchEvent.eType)),
                            map((watchEvent) => {
                                if(watchEvent.eType === 'ready') {
                                    scanComplete = true;
                                    return {
                                        eCategory: 'renderer',
                                        eType: 'partials-scanned',
                                    } satisfies Module.Event.Renderer.PartialsScanned;
                                }

                                return {
                                    eCategory: 'renderer',
                                    eType: 'partial-changed',
                                    fileEvent: watchEvent.eType as 'add' | 'change' | 'unlink',
                                    path: (watchEvent as WatchEvent.File).path,
                                    uri: (watchEvent as WatchEvent.File).uri,
                                    initialScan: !scanComplete,
                                } satisfies Module.Event.Renderer.PartialChanged;
                            })
                        ));

                        expectedScannedEvents++;
                    }

                    if(module.renderer.handlebarsHelpers) {
                        const helperEvents = Object.keys(module.renderer.handlebarsHelpers).map((name) => ({
                            eCategory: 'renderer' as const,
                            eType: 'handlebars-helper-changed' as const,
                            name,
                            helper: module.renderer!.handlebarsHelpers![name],
                        }));
                        installEventSources.push(from(helperEvents));
                    }

                    if(module.renderer.profileLayouts) {
                        const profileEvents = Object.keys(module.renderer.profileLayouts).map((profile) => ({
                            eCategory: 'renderer' as const,
                            eType: 'profile-layout-changed' as const,
                            profile,
                            uri: module.renderer!.profileLayouts![profile]
                        }));
                        initializeEventSources.push(from(profileEvents));
                    }

                    if(module.renderer.context) {
                        initializeEventSources.push(of({
                            eCategory: 'renderer' as const,
                            eType: 'context-changed' as const,
                            context: module.renderer.context,
                        }));
                    }
                }

                if(module.build) {
                    if(module.build.taskDefinitions) {
                        const taskDefinitionEvents = module.build.taskDefinitions.map((taskDefinition) => ({
                            eCategory: 'build' as const,
                            eType: 'task-definition-changed' as const,
                            taskDefinition,
                        }));
                        installEventSources.push(from(taskDefinitionEvents));
                    }
                }

                const moduleInstance: Module.Instance = {
                    name,
                    pluginFile: pluginFile,
                    module,
                    modulePath,
                    moduleEvents: concat(
                        merge(...installEventSources),
                        merge(...initializeEventSources),

                        watchEventSources.length > 0?
                            merge(...watchEventSources).pipe(
                                concatMap((event) => {
                                    if((event.eCategory === 'hypermedia' && event.eType === 'resources-scanned')
                                        || (event.eCategory === 'renderer' && event.eType === 'templates-scanned')
                                        || (event.eCategory === 'renderer' && event.eType === 'partials-scanned')) {
                                        expectedScannedEvents--;

                                        if(expectedScannedEvents === 0) {
                                            return concat(
                                                of(event),
                                                of({
                                                    eCategory: 'module' as const,
                                                    eType: 'initialized' as const,
                                                })
                                            );
                                        }
                                    }

                                    return of(event);
                                })
                            )
                        : of({
                            eCategory: 'module' as const,
                            eType: 'initialized' as const,
                        })
                    )
                };

                this.modules.set(name, moduleInstance);
                return moduleInstance;
            })
        );
    }

    /** @returns list of modules that are dependencies of 'plugin', but have not been initialized with createModule */
    public findMissingModules(plugin: Plugin<any>): string[] {
        return plugin.dependencies.reduce((missing, dependency) => {
            const dependencyName = typeof dependency === 'string'? dependency: dependency.name;
            const module = this.modules.get(dependencyName);
            if(!module) {
                missing.push(dependencyName);
            }
            else {
                missing.push(...this.findMissingModules(module.pluginFile.plugin));
            }
            return missing;
        }, [] as string[]);
    }

    /** @returns list of plugins that are dependencies of 'plugin', but have not been loaded with loadPlugin */
    public findMissingPlugins(plugin: Plugin<any>): string[] {
        return plugin.dependencies.reduce((missing, dependency) => {
            const dependencyName = typeof dependency === 'string'? dependency: dependency.name;
            const node = this.dependencyGraph.node(dependencyName);
            if(!node || !node.pluginFile) {
                missing.push(dependencyName);
            }
            else {
                missing.push(...this.findMissingPlugins(node.pluginFile.plugin));
            }
            return missing;
        }, [] as string[]);
    }
}

export namespace PluginManager {
    export interface PluginNode {
        /** if pluginFile is undefined, this plugin is a dependency of another plugin, but has not been loaded itself */
        pluginFile?: Plugin.File;
    }
}

export class LoadPluginError extends Error {
    public error?: Error;
    public path: string;
    constructor(message: string, pluginPath: string, err?: Error) {
        super(`Failed to load plugin ${pluginPath}: ${err && err.name || 'Error'}: ${message}`);
        Object.setPrototypeOf(this, LoadPluginError.prototype);
        this.path = pluginPath;
    }
}
