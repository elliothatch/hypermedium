import * as Path from 'path';
import { validate, validateData } from 'fresh-validation';
import * as fs from 'fs-extra';
import { Graph, Edge } from 'graphlib';
import { concat, defer, EMPTY, from, merge, of, Observable } from 'rxjs';
import { filter, map, mergeMap } from 'rxjs/operators';

import { WatchEvent, watchFiles } from './util';

import { Plugin, Module } from './plugin';

export class PluginManager {
    /** each node is a PluginNode, edges point toward dependencies */
    public dependencyGraph: Graph;
    /** maps names to module instances */
    public modules: Map<string, Module.Instance>;

    constructor() {
        this.dependencyGraph = new Graph();
        this.dependencyGraph.setDefaultNodeLabel((name: string) => ({}));

        this.modules = new Map();
    }

    /** loads a plugin file from disk and adds it to the dependency tree */
    public loadPlugin(pluginPath: string): Plugin.File {
        let jsModule: any;
        try {
            jsModule = require(pluginPath);
            if(!jsModule || !jsModule.default) {
                throw new LoadPluginError('no default export found', pluginPath);
            }

            jsModule = jsModule.default;
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

        const pluginFile: Plugin.File = {
            plugin,
            path: pluginPath
        };

        this.dependencyGraph.setNode(plugin.name, pluginFile);

        plugin.dependencies.forEach((dependency) => {
            this.dependencyGraph.setEdge(plugin.name, dependency);
        });

        return pluginFile;
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
            const pluginDir = Path.join(pluginNode.pluginFile.path, pluginNode.pluginFile.plugin.basePath || '');

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
                const moduleEventSources: Array<Observable<Module.Event>> = [];

                // set up watch events for the module
                if(module.hypermedia) {
                    if(module.hypermedia.sitePaths) {
                        const sitePaths = module.hypermedia.sitePaths.map((sitePath) => Path.join(modulePath, sitePath));
                        moduleEventSources.push(watchFiles(sitePaths, module.hypermedia.baseUri).pipe(
                            filter((watchEvent) => ['add', 'change', 'unlink'].includes(watchEvent.eType)),
                            map((watchEvent) => ({
                                eCategory: 'hypermedia',
                                eType: 'resource-changed',
                                fileEvent: watchEvent.eType as 'add' | 'change' | 'unlink',
                                path: watchEvent.path,
                                uri: watchEvent.uri,
                            }))
                        ));
                    }

                    if(module.hypermedia.processorFactories) {
                        const factoryEvents = Object.keys(module.hypermedia.processorFactories).map((name) => ({
                            eCategory: 'hypermedia' as const,
                            eType: 'processor-factory-changed' as const,
                            name,
                            processorFactory: module.hypermedia!.processorFactories![name]
                        }));
                        moduleEventSources.push(from(factoryEvents));
                    }
                }

                if(module.renderer) {
                    if(module.renderer.templatePaths) {
                        const templatePaths = module.renderer.templatePaths.map((sitePath) => Path.join(modulePath, sitePath));
                        moduleEventSources.push(watchFiles(templatePaths).pipe(
                            filter((watchEvent) => ['add', 'change', 'unlink'].includes(watchEvent.eType)),
                            map((watchEvent) => ({
                                eCategory: 'renderer',
                                eType: 'template-changed',
                                fileEvent: watchEvent.eType as 'add' | 'change' | 'unlink',
                                path: watchEvent.path,
                                uri: watchEvent.uri,
                            }))
                        ));
                    }

                    if(module.renderer.partialPaths) {
                        const partialPaths = module.renderer.partialPaths.map((sitePath) => Path.join(modulePath, sitePath));
                        moduleEventSources.push(watchFiles(partialPaths).pipe(
                            filter((watchEvent) => ['add', 'change', 'unlink'].includes(watchEvent.eType)),
                            map((watchEvent) => ({
                                eCategory: 'renderer',
                                eType: 'partial-changed',
                                fileEvent: watchEvent.eType as 'add' | 'change' | 'unlink',
                                path: watchEvent.path,
                                uri: watchEvent.uri,
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
                        moduleEventSources.push(from(helperEvents));
                    }

                    if(module.renderer.profileLayouts) {
                        const profileEvents = Object.keys(module.renderer.profileLayouts).map((profile) => ({
                            eCategory: 'renderer' as const,
                            eType: 'profile-layout-changed' as const,
                            profile,
                            layoutUri: module.renderer!.profileLayouts![profile]
                        }));
                        moduleEventSources.push(from(profileEvents));
                    }
                }

                const moduleInstance = {
                    name,
                    pluginFile: pluginFile,
                    module,
                    modulePath,
                    moduleEvents: merge(...moduleEventSources)
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
            if(!node || !node.plugin) {
                missing.push(dependency);
            }
            else {
                missing.push(...this.findMissingPlugins(node.plugin));
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
    constructor(message: string, modulePath: string, err?: Error) {
        super(`Failed to load plugin ${modulePath}: ${err && err.name || 'Error'}: ${message}`);
        Object.setPrototypeOf(this, LoadPluginError.prototype);
    }
}
