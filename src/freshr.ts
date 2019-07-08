import { Socket } from 'socket.io';
import { merge, Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

import { Hypermedia } from './hypermedia';
import { HypermediaRenderer } from './hypermedia-renderer';
import { BuildManager } from './build';

import { Plugin } from './plugin';
import { Processor } from './hypermedia/processor';
import { TaskDefinition } from './build';

export class Freshr {
    public hypermedia: Hypermedia;
    public renderer: HypermediaRenderer;
    public build: BuildManager;

    public processorGenerators: Map<string, Plugin.ProcessorGenerator>;

    public sitePath: string;


    constructor(sitePath: string) {
        this.sitePath = sitePath;
        this.hypermedia = new Hypermedia({
            curies: [],
            processors: [],
        });
        this.renderer = new HypermediaRenderer({
            hypermedia: this.hypermedia,
        });
        this.build = new BuildManager(sitePath);

        this.processorGenerators = new Map();
    }

    loadAndRegisterPlugins(names: string[], searchPath: string): Observable<Plugin> {
        return merge(...names.map((name) => Plugin.load(name, searchPath))).pipe(
            tap((plugin) => this.registerPlugin(plugin))
        );
    }

    registerPlugin(plugin: Plugin): void {
        const module = plugin.moduleFactory({
            basePath: this.sitePath
        });

        if(module.processorGenerators) {
            Object.keys(module.processorGenerators).forEach((generatorName) => {
                this.processorGenerators.set(
                    `${plugin.name}/${generatorName}`,
                    module.processorGenerators![generatorName]
                );
            });
            // this.hypermedia.processors.push(...plugin.module.processors);
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
                this.renderer.registerTemplate(template, plugin.name);
            });
        }
    }
}

export namespace Freshr {
    export interface Options {
        hypermedia: Hypermedia.Options;
        renderer: HypermediaRenderer.Options;
    }
}


