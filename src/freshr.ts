import { Socket } from 'socket.io';

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

    constructor(hypermedia: Hypermedia, renderer: HypermediaRenderer, build: BuildManager, options: Freshr.Options) {
    }

    registerPlugin(plugin: Plugin): void {
        if(plugin.processors) {
            this.hypermedia.processors.push(...plugin.processors);
        }

        if(plugin.taskDefinitions) {
            plugin.taskDefinitions.forEach((taskDefinition) => {
                this.build.taskDefinitions.set(taskDefinition.name, taskDefinition);
            });
        }

        if(plugin.profileLayouts) {
            this.renderer.profileLayouts = Object.assign({}, plugin.profileLayouts, this.renderer.profileLayouts);
        }
    }
}

export namespace Freshr {
    export interface Options {
        hypermedia: Hypermedia.Options;
        renderer: HypermediaRenderer.Options;
    }
}


