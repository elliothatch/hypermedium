import * as JsonLD from '../json-ld';

import { ResourceGraph } from './resource-graph';
import { Processor } from './processor';
import { DynamicResource } from './dynamic-resource';

export type Event =
    Event.ProcessResource
     | Event.ProcessResourceStart
     | Event.LoadResource
     | Event.UnloadResource
     | Event.LoadFile
     | Event.AddDependency
     | Event.ProcessorError
     | Event.Warning
     | Event.Trace
     | Event.ProcessorLog
     | Event.DynamicResourceError
     | Event.DynamicResourceLog;

export namespace Event {
    export interface ProcessResource {
        eType: 'ProcessResource';

        /** execution time in milliseconds */
        duration: number;
        uri: JsonLD.IRI;
        edges: ResourceGraph.Edge[];
        resource: JsonLD.Document;
        processors: Processor[];
    }

    export interface ProcessResourceStart {
        eType: 'ProcessResourceStart';

        uri: JsonLD.IRI;
    }

    export interface LoadResource {
        eType: 'LoadResource';

        uri: JsonLD.IRI;
        resource: JsonLD.Document;
    }

    export interface UnloadResource {
        eType: 'UnloadResource';

        uri: JsonLD.IRI;
    }

    export interface LoadFile {
        eType: 'LoadFile';

        uri: JsonLD.IRI;
        path: string;
    }

    export interface AddDependency {
        eType: 'AddDependency';

        v: string;
        w: string;

        /** name of the processor */
        processor: string;
    }

    export interface ProcessorError {
        eType: 'ProcessorError';

        uri: JsonLD.IRI;
        error: Error;
    }

    export interface Warning {
        eType: 'Warning';

        message: string;
        data?: any;
    }

    export interface Trace {
        eType: 'Trace';

        message: string;
        data?: any;
    }

    export interface ProcessorLog {
        eType: 'ProcessorLog';
        log: any;
    }

    export interface DynamicResourceError {
        eType: 'DynamicResourceError';
        error: Error;
        dynamicResource: DynamicResource,
        uri?: JsonLD.IRI;
    }

    export interface DynamicResourceLog {
        eType: 'DynamicResourceLog';
        log: any;
        uri?: JsonLD.IRI;
    }
}
