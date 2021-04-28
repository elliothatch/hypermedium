import * as HAL from '../hal';

import { HypermediaEngine } from './engine';
import { ExtendedResource } from './resource-graph';

export interface ResourceState<R extends HAL.Resource = ExtendedResource> {
    resource: R;
    uri: string;
    /** call this function to calculate values based on other resources.
     * has the side-effect of letting the processing engine know to reprocess this file
     * whenever the dependency changes.
     * if a resource is not found, it is replaced with `undefined`
     */
    getResource: (uri: HAL.Uri) => ExtendedResource | undefined;
    /** each processor has a local state HAL resource where it can store volitile/working memory. resources are stored at the uri /~hypermdium/state/:processor */
    getState: (property: string) => any;
    setState: (property: string, value: any) => void;
    /** the hypermedia engine instance. only use when necessary */
    hypermedia: HypermediaEngine;
}

export interface Processor {
    name: string;
    options?: any;
}

export namespace Processor {
    export interface ProcessorDefinition {
        name: string;
        onInit?: (rs: ResourceState, options: any) => void;
        onProcess: (rs: ResourceState, options: any) => ExtendedResource | Promise<ExtendedResource>;
        onDelete?: (rs: ResourceState, options: any) => void;
    }
}

