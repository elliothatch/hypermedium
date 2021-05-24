import { Logger } from 'freshlog';

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
    getState: (property: string | string[]) => any;
    setState: (property: string | string[], value: any) => void;
    /** immediately execute the processor, or execute all processors in order */
    execProcessor: <O = any>(processor: Processor<O> | Processor<O>[], resource?: ExtendedResource) => Promise<ExtendedResource>;
    /** the hypermedia engine instance. only use when necessary */
    hypermedia: HypermediaEngine;
    processor: Processor;
    logger: Logger;
}

export interface Processor<O = any> {
    name: string;
    options: O;
}

export namespace Processor {
    export interface Definition<N extends string = string, P = any, I = any, D = any> {
        name: N;
        onProcess: (rs: ResourceState, options: P) => ExtendedResource | Promise<ExtendedResource>;
        onInit?: (rs: ResourceState, options: I) => void;
        onDelete?: (rs: ResourceState, options: D) => void;
    }
}

