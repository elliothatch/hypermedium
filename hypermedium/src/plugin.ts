import { Observable } from 'rxjs';
import { validate } from 'fresh-validation';
import { HelperDelegate } from 'handlebars';

import { ProfileLayoutMap, TemplateRoute } from './renderer';
import { Processor, DynamicResource } from './hypermedia-engine';
import * as BuildManager from './build';

// TODO: should plugins be able to provide options for their dependencies, or otherwise control how their dependencies are initialized?
// TODO: include a way for plugins to describe the npm modules they require, for auto-installation. This should be a separate file (package.json), so the plugin file can import dependencies outside of the module factory?

/** Hypermedium functionality can be extended via modules. a Plugin describes how to create a module by defining a ModuleFactory */
export class Plugin<T = any> {
    /** unique identifier of the plugin */
    @validate()
    name!: string;
    @validate()
    /** plugin version */
    version!: string;
    /** plugin API version */
    pluginApi!: string;
    /** names of plugins that the module depends on */
    // TODO: update fresh-validation to handle array of union types 
    // @validate(false, String)
    dependencies!: Plugin.Dependency[];
    /** constructor function for the module */
    @validate()
    moduleFactory!: Module.Factory<T>;
    /** default options that should be used when calling moduleFactory */
    // @validate(true)
    // defaultOptions?: Module.Options & T;
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

    export type Dependency<T extends object = any> = string | {name: string, options: T};
}

// TODO: rename processor to transformer
/** The moduleFactory of a Plugin returns a Module that can be registered to extend hypermedium
 * all paths are relative to Plugin.baseUrl
 */
export type Module = Partial<{
    /** list of static file mappings, used in the webserver and site export
    * each entry maps "from" a file or directory relative to the module root, "to" an express-style route/pattern
    * if the entry is a string, it is mapped "from" that path "to" the root-level output
    */
    files?: Array<string | {from: string; to: string;}>;
    // TODO: options that describe how resources will be served by the webserver
    // baseUrl: string;
    hypermedia: Partial<{
        sitePaths: string[];
        /** new types of processor factories that can be used in the hypermedia engine */
        processorDefinitions: Processor.Definition[];
        /** processors that should be created and added to the hypermedia engine */
        processors: {[stage: string]: Processor[]};
        /** new types of dynamic resources that can be used in the hypermedia engine */
        dynamicResourceDefinitions: DynamicResource.Definition[];
        /** dynamic resource instances that should be created and added to the hypermedia engine */
        dynamicResources: DynamicResource[];
        /** if set, this url is prepended to the URI of every HAL resources served from this module */
        baseUri: string;
        /** files matching any of these extensions are loaded into the hypermedia engine as resources. these files MUST be parsable as json. should include the period `.`.
        * matches the entire string from the end of the file name, so ['.json'] will match 'example.json' and 'example.hyp.json', while ['.hyp.json'] only matches 'example.hyp.json'. ['.json', '.hyp.json'] has the same behavior as ['.json'].
        * defaults to ['.json'].
        */
        resourceExtensions: string[];
        // websocket middleware
    }>;
    renderer: Partial<{
        /** paths to search for templates */
        templatePaths: string[];
        /** list of router patterns mapping to template IRIs. each entry is installed as an express middleware--when a page is rendered, it uses the template associated with the first matching routerPath. if there are no matches, falls back to default.hbs */
        // TODO: since routes are matched in the order they are added, the plugins registered earlier always take precedence over later plugins. this is the opposite of desired behavior, as a plugin's dependencies are always loaded before the plugin, resulting in lowest precedence for the last (main) plugin loaded.
        templateRoutes: TemplateRoute[];
        /** paths to search for partials */
        partialPaths: string[];
        handlebarsHelpers: {[name: string]: HelperDelegate};
        profileLayouts: ProfileLayoutMap;
        /** every property in this object is assigned to the handlebars context object
            * if the value is a string, it is the url of a local resource, which is used as the context */
        context: {[property: string]: any} | string;
    }>;

    build: Partial<{
        buildSteps: BuildManager.Step;
        taskDefinitions: BuildManager.TaskDefinition[];
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
        /** communicate when any resource, asset, or setting in the module has been added, changed, or removed. hypermedium subscribes to moduleEvents on module initialization to register the plugin in hypermedium's hypermedia and render engines.
         * NOTE that Build events are NOT included in the moduleEvents stream. This is because the module may need to be built before it is used.
         * Hypermedium must register task definitions and perform the build BEFORE moduleEvents is subscribed to.
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

    // TODO: support returning a promise/observable
    export type Factory<T> = (options: Options & T) => Module;

    export type Event = Event.Module | Event.Hypermedia | Event.Renderer | Event.Build;
    export namespace Event {
        export type Module = Module.Initialized | Module.ModuleError;
        export namespace Module {
            export interface Base {
                eCategory: 'module';
            }
            /** emitted after all "install" events are complete */
            export interface Initialized extends Base {
                eType: 'initialized';
            }

            export interface ModuleError extends Base {
                eType: 'error';
                error: Error;
                uri?: string;
            }
        }
        export type Hypermedia = Hypermedia.ResourceChanged | Hypermedia.ResourcesScanned | Hypermedia.ProcessorDefinitionChanged | Hypermedia.ProcessorChanged | Hypermedia.DynamicResourceDefinitionChanged | Hypermedia.DynamicResourceChanged;
        export namespace Hypermedia {
            export interface Base {
                eCategory: 'hypermedia'
            }

            export interface ResourceChanged extends Base {
                eType: 'resource-changed';
                fileEvent: 'add' | 'change' | 'unlink';
                path: string;
                uri: string;
                initialScan: boolean;
            }

            /** emitted when the initial scan for resources has completed. */
            export interface ResourcesScanned extends Base {
                eType: 'resources-scanned';
            }

            export interface ProcessorDefinitionChanged extends Base {
                eType: 'processor-definition-changed';
                processorDefinition: Processor.Definition;
            }

            export interface ProcessorChanged extends Base {
                eType: 'processor-changed';
                processor: Processor;
                stage: string; //'pre' | 'post';
            }

            export interface DynamicResourceDefinitionChanged extends Base {
                eType: 'dynamic-resource-definition-changed';
                dynamicResourceDefinition: DynamicResource.Definition;
            }

            export interface DynamicResourceChanged extends Base {
                eType: 'dynamic-resource-changed';
                dynamicResource: DynamicResource;
            }
        }

        export type Renderer = Renderer.TemplateChanged | Renderer.TemplatesScanned | Renderer.TemplateRouteAdded | Renderer.PartialChanged | Renderer.PartialsScanned | Renderer.HandlebarsHelperChanged | Renderer.ProfileLayoutChanged | Renderer.ContextChanged;
        export namespace Renderer {
            export interface Base {
                eCategory: 'renderer';
            }

            export interface TemplateChanged extends Base {
                eType: 'template-changed';
                fileEvent: 'add' | 'change' | 'unlink';
                path: string;
                uri: string;
                initialScan: boolean;
            }

            /** emitted when the initial scan for templates has completed. */
            export interface TemplatesScanned extends Base {
                eType: 'templates-scanned';
            }

            export interface TemplateRouteAdded extends Base {
                eType: 'template-route-added';
                routerPattern: string;
                templateUri: string;
            }

            export interface PartialChanged extends Base {
                eType: 'partial-changed';
                fileEvent: 'add' | 'change' | 'unlink';
                path: string;
                uri: string;
                initialScan: boolean;
            }

            /** emitted when the initial scan for partials has completed. */
            export interface PartialsScanned extends Base {
                eType: 'partials-scanned';
            }

            export interface HandlebarsHelperChanged extends Base {
                eType: 'handlebars-helper-changed';
                name: string;
                helper: HelperDelegate;
            }

            export interface ProfileLayoutChanged extends Base {
                eType: 'profile-layout-changed';
                profile: string;
                uri: string;
            }

            export interface ContextChanged extends Base {
                eType: 'context-changed';
                context: {[property: string]: any} | string;
            }
        }

        export type Build = Build.TaskDefinitionChanged;
        export namespace Build {
            export interface Base {
                eCategory: 'build';
            }

            export interface TaskDefinitionChanged extends Base {
                eType: 'task-definition-changed';
                taskDefinition: BuildManager.TaskDefinition;
            }
        }
    }
}
