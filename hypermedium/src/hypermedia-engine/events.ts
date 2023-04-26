import * as HAL from '../hal';

import { ResourceGraph } from './resource-graph';
import { Processor } from './processor';

export type Event =
    Event.ProcessResource
     | Event.ProcessResourceStart
     | Event.LoadResource
     | Event.UnloadResource
     | Event.LoadFile
     | Event.AddDependency
     | Event.ProcessorError
     | Event.Warning
     | Event.ProcessorLog;

export namespace Event {
    export interface ProcessResource {
        eType: 'ProcessResource';

        /** execution time in milliseconds */
        duration: number;
        uri: HAL.Uri;
        edges: ResourceGraph.Edge[];
        resource: HAL.ExtendedResource;
        processors: Processor[];
    }

    export interface ProcessResourceStart {
        eType: 'ProcessResourceStart';

        uri: HAL.Uri;
    }

    export interface LoadResource {
        eType: 'LoadResource';

        uri: HAL.Uri;
        resource: HAL.Resource;
    }

    export interface UnloadResource {
        eType: 'UnloadResource';

        uri: HAL.Uri;
    }

    export interface LoadFile {
        eType: 'LoadFile';

        uri: HAL.Uri;
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

        uri: HAL.Uri;
        error: Error;
    }

    export interface Warning {
        eType: 'Warning';

        message: string;
        data?: any;
    }

    export interface ProcessorLog {
        eType: 'ProcessorLog';
        log: any;
    }
}
