import { Socket } from 'socket.io';

import { Processor } from './hypermedia/processor';
import { PartialMap, ProfileLayoutMap, TemplateMap } from './hypermedia-renderer';
import { TaskDefinition } from './build';

export interface Plugin {
    name: string;

    /* hypermedia */
    processors?: Processor[];

    /* apis */
    websocketMiddleware?: Plugin.WebsocketMiddleware;

    /* hypermedia renderer */

    /** maps profiles to layout names  */
    profileLayouts?: ProfileLayoutMap
    partials?: PartialMap;
    templates?: TemplateMap;

    /* build system */
    taskDefinitions?: TaskDefinition[];
}

export namespace Plugin {
    export type WebsocketMiddleware = (socket: Socket, fn: (err?: any) => void) => void;
    export type Factory = (options: Options) => Plugin;

    export interface Options {
        /** path to the root of the project directory */
        basePath: string;
    }
}

// export function loadPlugin(path: string): Plugin {
// }
