import * as Path from 'path';
import { validateData } from 'fresh-validation';
import * as fs from 'fs-extra';
import { Graph } from 'graphlib';
import { concat, defer, from, merge, of, Observable } from 'rxjs';
import { filter, map } from 'rxjs/operators';

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
    * @returns list of newly loaded plugins (not including plugins/dependencies that were already loaded) */
    public loadPluginsAndDependencies(pluginNames: string[], searchPaths: string[]) {
        const loadedPlugins: Plugin.File[] = [];
        pluginNames.forEach((pluginName) => {
            const node = this.dependencyGraph.node(pluginName);
            let pluginFile: Plugin.File | undefined = node?.pluginFile;
            if(!pluginFile) {
                pluginFile = this.findAndLoadPlugin(pluginName, searchPaths);
                loadedPlugins.push(pluginFile);
            }

            const loadedDependencies = this.loadPluginsAndDependencies(pluginFile.plugin.dependencies, searchPaths);

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
            // console.log(`adding dependency: ${dependency} -> ${plugin.name}`);
            this.dependencyGraph.setEdge(dependency, plugin.name);
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
                // install event sources contain all events that need to be performed before "ongoing/file watch" events. this includes creating processor factories, handlebars helpers, and task definitions
                const installEventSources: Array<Observable<Module.Event>> = [];
                const moduleEventSources: Array<Observable<Module.Event>> = [];

                // set up watch events for the module
                if(module.hypermedia) {
                    if(module.hypermedia.sitePaths) {
                        const sitePaths = module.hypermedia.sitePaths.map((sitePath) => Path.join(modulePath, sitePath));
                        // hypermedia resources should always be absolute paths
                        // TODO: should hypermedia engine should deal with uri normalization?
                        const baseUri = module.hypermedia.baseUri != null?
                            module.hypermedia.baseUri:
                            '/';
                        moduleEventSources.push(watchFiles(sitePaths, baseUri).pipe(
                            filter((watchEvent) => ['add', 'change', 'unlink'].includes(watchEvent.eType)),
                            map((watchEvent) => ({
                                eCategory: 'hypermedia',
                                eType: 'resource-changed',
                                fileEvent: watchEvent.eType as 'add' | 'change' | 'unlink',
                                path: (watchEvent as WatchEvent.File).path,
                                uri: (watchEvent as WatchEvent.File).uri,
                            }))
                        ));
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
                        moduleEventSources.push(from(processorEvents));
                    }

                    if(module.hypermedia.stateProcessors) {
                        // TODO: is this a race condition with processorDefinitions?


                        const processorEvents = Object.keys(module.hypermedia.stateProcessors).reduce((arr: {processor: Processor, stage: string}[], stage) => {
                            return arr.concat(module.hypermedia!.stateProcessors![stage].map((processor) => ({processor, stage})));
                        }, []).map(({processor, stage}) => ({
                            eCategory: 'hypermedia' as const,
                            eType: 'state-processor-changed' as const,
                            processor,
                            stage
                        }));
                        moduleEventSources.push(from(processorEvents));
                    }
                }

                if(module.renderer) {
                    if(module.renderer.templatePaths) {
                        const templatePaths = module.renderer.templatePaths.map((templatePath) => Path.join(modulePath, templatePath));
                        moduleEventSources.push(watchFiles(templatePaths).pipe(
                            filter((watchEvent) => ['add', 'change', 'unlink'].includes(watchEvent.eType)),
                            map((watchEvent) => ({
                                eCategory: 'renderer',
                                eType: 'template-changed',
                                fileEvent: watchEvent.eType as 'add' | 'change' | 'unlink',
                                path: (watchEvent as WatchEvent.File).path,
                                uri: (watchEvent as WatchEvent.File).uri,
                            }))
                        ));
                    }

                    if(module.renderer.partialPaths) {
                        const partialPaths = module.renderer.partialPaths.map((partialPath) => Path.join(modulePath, partialPath));
                        moduleEventSources.push(watchFiles(partialPaths).pipe(
                            filter((watchEvent) => ['add', 'change', 'unlink'].includes(watchEvent.eType)),
                            map((watchEvent) => ({
                                eCategory: 'renderer',
                                eType: 'partial-changed',
                                fileEvent: watchEvent.eType as 'add' | 'change' | 'unlink',
                                path: (watchEvent as WatchEvent.File).path,
                                uri: (watchEvent as WatchEvent.File).uri,
                            }))
                        ));
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
                        moduleEventSources.push(from(profileEvents));
                    }

                    if(module.renderer.context) {
                        moduleEventSources.push(of({
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
                        of({
                            eCategory: 'module' as const,
                            eType: 'initialized' as const,
                        }),
                        merge(...moduleEventSources)
                    )
                };

                this.modules.set(name, moduleInstance);
                return moduleInstance;
            })
        );
    }

    /** @returns list of modules that are dependencies of 'plugin', but have not been initalized with createModule */
    public findMissingModules(plugin: Plugin<any>): string[] {
        return plugin.dependencies.reduce((missing, dependency) => {
            const module = this.modules.get(dependency);
            if(!module) {
                missing.push(dependency);
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
            const node = this.dependencyGraph.node(dependency);
            if(!node || !node.pluginFile) {
                missing.push(dependency);
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
