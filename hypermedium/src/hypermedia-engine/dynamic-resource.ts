import { Logger } from 'freshlog';

import * as JsonLD from '../json-ld';
import { PropertyPath } from '../json-ld-util';

import { HypermediaEngine } from './engine';
import { ResourceGraph } from './resource-graph';

/**
 * Dynamic resources are processes that manage the creation, deletion, and updates of one or more Hypermedia documents.
 *
 * The purpose of a dynamic resource is to use external (or internal) data sources to create documents that can leverage processors and be referenced and used by other documents in the Hypermedia Engine
 *
 * For example, you can use the Index dynamic resource to create an index of certain pages in your site, and then reference that index in a table of contents, which will automatically update whenever a resource matching the index is added, removed, or changed.
 *
 * You can also have a dynamic resource that is tied to an external database or service which creates JSON representations for resources returned by queries to that database.
 */
export interface DynamicResource<O = any> {
    /** name of the DynamicResource.Definition */
    name: string;
    /** options specific to this dynamic resource */
    options: O;
    /** standard configuration options that control the configuration of the dynamic resource within the hypermedia engine */
    config?: Partial<{
        /** all created resources are relative to the baseUri.
        * defaults to the instance's root directory (/~hypermedium/dynamic/{name}/) */
        baseUri: JsonLD.IRI;
    }>;
}

export namespace DynamicResource {
    // TODO: give this a more descriptive name
    export interface Api<S = any> {
        /** creates or updates a resource in the resouce graph.
        * @param uri - uri of the resource, relative to the dynamic resource's baseUri
        * @returns promise that resolves after the new resource is created and has been processed, and a flag indicating if a new resource was created or an existing one was updated */
        createResource: (uri: JsonLD.IRI, resource: JsonLD.Document) => Promise<{resource: JsonLD.Document, updated: boolean}>;
        /** TODO: add createFile. this is tricky because resources only exist in memory, but files in the resource graph are only identified by their path. will need to add a directory on disk for dynamic files */
        // TODO: add deleteResource/File
        hypermedia: HypermediaEngine;
        logger: Logger;
        /** custom state used by the dynamic resource */
        state: S;
    }

    export interface Definition<N extends string = string, O = any, S = any> {
        name: N;
        /** called when the dynamic resource is created.
        * @returns undefined, or a promise to indicate that async initialization has completed. */
        init?: (api: Api<S>, options: O) => Promise<any> | void;
        // TODO: add cleanup callback

        // TODO: dynamic resources can create infinite loops if they are allowed onProcess resource events
        // consider an Index dynamic resource that indexes @type, and a ResourceGraph dynamic resource that creates a graph of all nodes in the graph. when the index is created/updated via onProcess, the resource graph will subsequently be updated to include the new/updated index pages. but since the resourceGraph resource also has @type, this will require an update from Index, which will add resourceGraph to the index, causing another onProcess on resourceGraph, etc.
        // we can avoid this specific problem by being conservative about updating Index resources if the index didn't actually change. in general though, there is no way to prevent this kind of loop when using onProcess.
        /** these callbacks are triggered whenever nodes/resources are added, processed, or deleted in the resource graph.
        * they are never called for resources that were created by this dynamic resource.
* @returns optional promise to indicate that an async dynamic resource calucaltion has completed. */
        resourceEvents?: Partial<{
        /** called BEFORE the resource is processed for the first time. usually you will want to use onProcess instead. */
            onAdd: (uri: JsonLD.IRI, resource: JsonLD.Document, api: Api<S>, options: O) => Promise<any> | void;
        /** called AFTER a resource has completed processing, but before dependent resources are processed */
            onProcess: (uri: JsonLD.IRI, resource: JsonLD.Document, api: Api<S>, options: O) => Promise<any> | void;
            /** called immediately AFTER the resource is removed from the resource graph */
            onDelete: (uri: JsonLD.IRI, resource: JsonLD.Document, api: Api<S>, options: O) => Promise<any> | void;
        }>;
        /** same as resourceEvents, but for any node in the resource graph (resource/file/dynamic-resource)
         * prefer resourceEvents if all node data is not needed
        * called before respective resourceEvents callbacks. if these callbacks return a promise, the resourceEvent callback is triggered only after it completes.
         */
        nodeEvents?: Partial<{
            onAdd: (uri: JsonLD.IRI, node: ResourceGraph.Node, api: Api<S>, options: O) => Promise<any> | void;
            onProcess: (uri: JsonLD.IRI, node: ResourceGraph.Node, api: Api<S>, options: O) => Promise<any> | void;
            onDelete: (uri: JsonLD.IRI, node: ResourceGraph.Node, api: Api<S>, options: O) => Promise<any> | void;
        }>;
    }
}

