import { Socket } from 'socket.io';
import { merge, Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { Hypermedia } from './hypermedia';
import { HypermediaRenderer } from './hypermedia-renderer';
import { BuildManager } from './build';

import { Plugin } from './plugin';
import { Processor } from './hypermedia/processor';
import { TaskDefinition } from './build';

import { FileError, NotFoundError } from './util';

export class Freshr {
    public hypermedia: Hypermedia;
    public renderer: HypermediaRenderer;
    public build: BuildManager;

    public processorGenerators: Map<string, Plugin.ProcessorGenerator>;

    public sitePath: string;

    constructor(sitePath: string, options?: Partial<Freshr.Options>) {
        this.sitePath = sitePath;
        this.hypermedia = new Hypermedia(Object.assign(
            {
                curies: [],
            },
            options && options.hypermedia,
            {
                processors: [],
            }
        ));

        this.renderer = new HypermediaRenderer(Object.assign(
            {},
            options && options.renderer,
            {
                hypermedia: this.hypermedia,
            }
        ));

        this.build = new BuildManager(sitePath);

        this.processorGenerators = new Map();
    }

    loadAndRegisterPlugins(names: string[], searchPath: string): Observable<{plugin: Plugin, module: Plugin.Module, errors: FileError[]}> {
        return merge(...names.map((name) => Plugin.load(name, searchPath))).pipe(
            map(({plugin, errors}) => ({plugin, errors, module: this.registerPlugin(plugin)}))
        );
    }

    registerPlugin(plugin: Plugin): Plugin.Module {
        const module = !plugin.moduleFactory? {}: plugin.moduleFactory({
            basePath: this.sitePath
        });

        if(module.processorGenerators) {
            Object.keys(module.processorGenerators).forEach((generatorName) => {
                this.processorGenerators.set(
                    `${plugin.name}/${generatorName}`,
                    module.processorGenerators![generatorName]
                );
            });
        }

        if(module.taskDefinitions) {
            module.taskDefinitions.forEach((taskDefinition) => {
                this.build.taskDefinitions.set(taskDefinition.name, taskDefinition);
            });
        }

        if(module.profileLayouts) {
            this.renderer.profileLayouts = Object.assign({}, module.profileLayouts, this.renderer.profileLayouts);
        }

        if(plugin.partials) {
            plugin.partials.forEach((partial) => {
                this.renderer.registerPartial(partial, plugin.name);
            });
        }

        if(plugin.templates) {
            plugin.templates.forEach((template) => {
                console.log(plugin.name, template);
                this.renderer.registerTemplate(template, plugin.name);
            });
        }

        return module;
    }

    addProcessor(generatorName: string, options?: any): Processor {
        const generator = this.processorGenerators.get(generatorName);
        if(!generator) {
            throw new NotFoundError(generatorName);
        }

        const processor = generator(options);
        this.hypermedia.processors.push(processor);
        return processor;
    }
}

export namespace Freshr {
    export interface Options {

        hypermedia: Partial<Hypermedia.Options>;
        renderer: Partial<HypermediaRenderer.Options>;
    }
}


