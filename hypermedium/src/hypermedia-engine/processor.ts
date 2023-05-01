import { Logger } from 'freshlog';

import * as HAL from '../hal';
import { PropertyPath } from '../hal-util';

import { HypermediaEngine } from './engine';

export interface ResourceState<R extends HAL.Resource = HAL.ExtendedResource> {
    resource: R;
    uri: string;
    /** call this function to calculate values based on other resources.
     * has the side-effect of letting the processing engine know to reprocess this file
     * whenever the dependency changes.
     * if a resource is not found, it is replaced with `undefined`
     */
    getResource: (uri: HAL.Uri) => HAL.ExtendedResource | undefined;
    /** call this function to calculate values based on non-resource files. returns the system path to the file
     * has the side-effect of letting the processing engine know to reprocess this file
     * whenever the dependency changes.
     * if a resource is not found, it is replaced with `undefined`
     */
    getFile: (uri: HAL.Uri) => string | undefined;
    /** immediately execute the processor, or execute all processors in order */
    execProcessor: <O = any>(processor: Processor<O> | Processor<O>[], resource?: HAL.ExtendedResource) => Promise<HAL.ExtendedResource>;
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
    export interface Definition<N extends string = string, P = any> {
        name: N;
        onProcess: (rs: ResourceState, options: P) => HAL.ExtendedResource | Promise<HAL.ExtendedResource>;
    }
}

