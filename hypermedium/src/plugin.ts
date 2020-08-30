import { Observable } from 'rxjs';
import { validate } from 'fresh-validation';
import { HelperDelegate } from 'handlebars';

import { ProfileLayoutMap } from './renderer';
import { Processor } from './hypermedia-engine';
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

/** The moduleFactory of a Plugin returns a Module that can be registered to extend hypermedium
 * all paths are relative to Plugin.baseUrl
 */
export type Module = Partial<{
    // TODO: options that describe how resources will be served by the webserver
    // baseUrl: string;
    // templatePaths desribe which templates will be used to serve which URLs
    hypermedia: Partial<{
        sitePaths: string[];
        /** new types of processor factories that can be used in the hypermedia engine */
        processorFactories: {[name: string]: Processor.Factory};
        /** processors that should be created and added to the hypermedia engine */
        processors: {name: string; options?: any}[];
        /** if set, this url is prepended to the URI of every HAL resources served from this module */
        baseUri: string;
        // websocket middleware
    }>;
    renderer: Partial<{
        templatePaths: string[];
        partialPaths: string[];
        handlebarsHelpers: {[name: string]: HelperDelegate};
        profileLayouts: ProfileLayoutMap;
        /** every property in this object is assigned to the handlebars context object */
        context: {[property: string]: any};
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
        export type Module = Module.Initialized;
        export namespace Module {
            export interface Base {
                eCategory: 'module';
            }
            /** emitted after all "install" events are complete */
            export interface Initialized extends Base {
                eType: 'initialized';
            }
        }
        export type Hypermedia = Hypermedia.ResourceChanged | Hypermedia.ProcessorFactoryChanged | Hypermedia.ProcessorChanged;
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
                processorFactory: Processor.Factory;
            }

            export interface ProcessorChanged extends Base {
                eType: 'processor-changed';
                name: string;
                options?: any;
            }
        }

        export type Renderer = Renderer.TemplateChanged | Renderer.PartialChanged | Renderer.HandlebarsHelperChanged | Renderer.ProfileLayoutChanged | Renderer.ContextChanged;
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

            export interface ContextChanged extends Base {
                eType: 'context-changed';
                context: {[property: string]: any};
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
