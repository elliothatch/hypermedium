import * as Path from 'path';
import { validate, validateData } from 'fresh-validation';
import * as fs from 'fs-extra';
import { Graph, Edge } from 'graphlib';
import { concat, defer, EMPTY, from, merge, of, Observable } from 'rxjs';
import { filter, map, mergeMap } from 'rxjs/operators';
import { HelperDelegate } from 'handlebars';

import { BuildStep, TaskDefinition } from './build';
import { ProfileLayoutMap } from './hypermedia-renderer';
import { Processor } from './hypermedia';
import { WatchEvent, watchFiles } from './util';

// TODO: should plugins be able to provide options for their dependencies, or otherwise control how their dependencies are initialized?
// TODO: include a way for plugins to describe the npm modules they require, for auto-installation. This should be a separate file (package.json), so the plugin file can import dependencies outside of the module factory?

/** Freshr functionality can be extended via modules. a Plugin describes how to create a module by defining a ModuleFactory */
export class Plugin<T = any> {
    /** unique identifier of the plugin */
    @validate()
    name!: string;
    @validate()
    version!: string;
    /** names of plugins that the module depends on */
    @validate(false, String)
    dependencies!: string[];
    /** constructor function for the module */
    @validate()
    moduleFactory!: Module.Factory<T>;
    /** default options that should be used when calling moduleFactory */
    @validate(true)
    defaultOptions?: Module.Options & T;
    /** path to the root directory of the plugin, relative to the plugin file.
     * when a Module is instanced, this is used to determine the baseDir of the module
     * if undefined, the directory immediately containing the Plugin is used */
    @validate(true)
    basePath?: string;
}

export namespace Plugin {
    /** a Plugin.File represensts a single javascript file that has a plugin object as its default export. */
    export interface File<T = any> {
        /** the plugin object, created with 'require(path).default' */
        plugin: Plugin<T>;
        /** absolute path to the javascript file containing a plugin */
        path: string;
    }
}

/** The moduleFactory of a Plugin returns a Module that can be registered to extend freshr
 * all paths are relative to Plugin.baseUrl
 */
export type Module = Partial<{
    // TODO: options that describe how resources will be served by the webserver
    // baseUrl: string;
    // templatePaths desribe which templates will be used to serve which URLs
    hypermedia: Partial<{
        sitePaths: string[];
        processorFactories: {[name: string]: Module.ProcessorFactory};
        /** if set, this url is prepended to the URI of every HAL resources served from this module */
        baseUri: string;
        // websocket middleware
    }>;
    renderer: Partial<{
        templatePaths: string[];
        partialPaths: string[];
        handlebarsHelpers: {[name: string]: HelperDelegate};
        profileLayouts: ProfileLayoutMap;
    }>;

    build: Partial<{
        buildSteps: BuildStep;
        taskDefinitions: TaskDefinition[];
    }>;

    componentPaths: string[];
}>;

export namespace Module {
    /** an instance of a module. contains properties that modules aren't allowed to set themselves */
    export interface Instance {
        name: string;
        pluginFile: Plugin.File;
        module: Module;
        /** absolute path to the root directory of the module. all Module paths are relative to this path
         * created by combining Plugin.basePath with Options.instancePath */
        modulePath: string;
        /** communicate when any resource, asset, or setting in the module has been added, changed, or removed. Freshr subscribes to moduleEvents on module initialization to register the plugin in freshr's hypermedia and render engines.
         * NOTE that Build events are NOT included in the moduleEvents stream. This is because the module may need to be built before it is used.
         * Freshr must register task definitions and perform the build BEFORE moduleEvents is subscribed to.
         * Task definitions MUST be registered before the build is started, as the plugin may use its own task definitions in its build steps.
         */
        moduleEvents: Observable<Module.Event>;
    }
    export interface Options {
        /** if provided, will create the module as an "isolated instance".
         * this will clone all the files in the plugin directory into the specified directory.
         * if undefined, the plugin directory will be used directly and no copy is made */
        instancePath?: string;
    }

    export type ProcessorFactory = (options?: any) => Processor;

    // TODO: support returning a promise/observable
    export type Factory<T> = (options: Options & T) => Module;

    export type Event = Event.Hypermedia | Event.Renderer;
    export namespace Event {
        export type Hypermedia = Hypermedia.ResourceChanged | Hypermedia.ProcessorFactoryChanged;
        export namespace Hypermedia {
            export interface Base {
                eCategory: 'hypermedia'
            }

            export interface ResourceChanged extends Base {
                eType: 'resource-changed';
                fileEvent: 'add' | 'change' | 'unlink';
                path: string;
                uri: string;
            }

            export interface ProcessorFactoryChanged extends Base {
                eType: 'processor-factory-changed';
                name: string;
                processorFactory: ProcessorFactory;
            }
        }

        export type Renderer = Renderer.TemplateChanged | Renderer.PartialChanged | Renderer.HandlebarsHelperChanged | Renderer.ProfileLayoutChanged;
        export namespace Renderer {
            export interface Base {
                eCategory: 'renderer';
            }

            export interface TemplateChanged extends Base {
                eType: 'template-changed';
                fileEvent: 'add' | 'change' | 'unlink';
                path: string;
                uri: string;
            }

            export interface PartialChanged extends Base {
                eType: 'partial-changed';
                fileEvent: 'add' | 'change' | 'unlink';
                path: string;
                uri: string;
            }

            export interface HandlebarsHelperChanged extends Base {
                eType: 'handlebars-helper-changed';
                name: string;
                helper: HelperDelegate;
            }

            export interface ProfileLayoutChanged extends Base {
                eType: 'profile-layout-changed';
                profile: string;
                layoutUri: string;
            }
        }
    }
}

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
