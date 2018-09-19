import * as Path from 'path';
import { promises as fs } from 'fs';
import * as Url from 'url';

import { Router, Request, Response } from 'express';

/* types based on spec draft (https://tools.ietf.org/html/draft-kelly-json-hal-08) */
namespace HAL {
    export type Uri = string;
    export type UriTemplate = string;

    /** represents a hyperlink from the containing resource to a URI. */
    export interface Link {
        href: Uri | UriTemplate;
        /** SHOULD be true when the Link Object's "href" property is a URI Template. */
        templated?: boolean
        /** a hint to indicate the media type (MIME) expected when dereferencing the target resource. */
        type?: string;
        /** presence indicates that the link is to be deprecated (i.e. removed) at a future date.
         * Its value is a URL that SHOULD provide further information about the deprecation. */
        deprecation?: Uri;
        /** Its value MAY be used as a secondary key for selecting Link Objects which share the same relation type. */
        name?: string;
        /** hints about the profile (as defined by [I-D.wilde-profile-link]) of the target resource. */
        profile?: Uri;
        /** labels the link with a human-readable identifier. */
        title?: string;
        /** indicates the language of the target resource. */
        hreflang?: string;
    }

    export interface Resource {
        /** an object whose property names are link relation types.
         * The subject resource of these links is the Resource Object of which the containing "_links" object is a property. */
        '_links'?: {[rel: string]: Link | Link[]};
        /** an object whose property names are link relation types.
         * MAY be a full, partial, or inconsistent version of the representation served from the target URI. */
        '_embedded'?: {[rel: string]: Resource | Resource[]};
    }

    export interface Curi {
        /** must contain the {rel} placeholder */
        href: string;
        name: string;
        templated: boolean;
    }
}

/** augments a hypermedia site with dynamic properties and resources
 * for example, adds "self" links and "breadcrumb"
 * dynamic resources like comments can be updated with CRUD actions through hypermedia
 * dynamic tagging
 */
class Hypermedia {
    public router: Router;
    public state: Hypermedia.State;
    public processors: Hypermedia.Processor[];
    public resources: Hypermedia.ResourceMap;

    constructor(options: Hypermedia.Options) {
        this.state = {
            baseUri: options.baseUri,
            curies: options.curies,
            tags: {},
        };
        this.processors = options.processors;
        this.resources = {};
        this.router = Router();

        // this.router.use();
    }

    public processResource(relativeUri: HAL.Uri, resource: HAL.Resource): HAL.Resource {
        const result = this.processors.reduce(
            (d, processor) => processor(d), {resource, relativeUri, state: this.state});

        this.state = result.state;
        this.resources[relativeUri] = result.resource;

        return result.resource;
    }

    /** recursively process files in a directory */
     public processDirectory(directoryPath: string, relativeUri: HAL.Uri = ''): Promise<Hypermedia.ResourceMap> {
         return walkDirectory(
             directoryPath,
             (filePath: string, uri: string, fileContents: string) => (
                 this.processResource(uri, JSON.parse(fileContents))),
             relativeUri,
         );
     }
}

namespace Hypermedia {
    export interface Options {
        /** if provided, this string prefixes the "href" property on all all site-local links. e.g. "https://example.com" */
        baseUri?: string;
        curies: HAL.Curi[];
        processors: Processor[];
    }

    /** Dynamically calculated properties of the hypermedia site. */
    export interface State {
        baseUri?: string;
        curies: HAL.Curi[];
        /** maps tag name to list of URIs that have tagged this word */
        tags: {[tag: string]: string[]};
    }

    export interface ExtendedResource extends HAL.Resource {
        [uri: string]: any;
    }

    export interface ResourceState<R extends HAL.Resource = ExtendedResource, S extends State = State> {
        resource: R;
        relativeUri: string;
        state: S;
    }

    export type ResourceMap = {[uri: string]: HAL.Resource};

    /** takes in a HAL object and some external state, and returns transformed versions
     * of each. */
    export type Processor = (rs: ResourceState) => ResourceState;

    export namespace Processor {
        export const self = (rs: ResourceState): ResourceState => (
            Object.assign(rs, {
                resource: Object.assign(rs.resource, {
                    _links: Object.assign({
                        self: rs.state.baseUri? Url.resolve(rs.state.baseUri, rs.relativeUri): rs.relativeUri
                    }, rs.resource._links)
                })
            })
        );

        export const tags = (rs: ResourceState): ResourceState => {
            getTags(rs.resource).forEach((t) => {
                if(!rs.state.tags[t]) {
                    rs.state.tags[t] = [];
                }
                rs.state.tags[t].push(rs.relativeUri);
            });
            return rs;
        };
    }
    /** get href of all "tag" links, or empty array */
    function getTags(resource: HAL.Resource): string[] {
        let tags = resource._links && resource._links.tag;
        if(!tags) {
            return [];
        }

        if(!Array.isArray(tags)) {
            tags = [tags];
        }
        return tags.map((t) => t.href);
    }
}

function loadHypermedia() {
}

type FileProcessor = (filePath: string, relativeUri: string, fileContents: string) => HAL.Resource;

function walkDirectory(directoryPath: string, f: FileProcessor, relativeUri: HAL.Uri = ''): Promise<Hypermedia.ResourceMap> {
    return fs.readdir(directoryPath).then((files) => {
        return Promise.all(files.map((filename) => {
            const filePath = Path.join(directoryPath, filename);
            const fileRelativeUri = `${relativeUri}/${filename}`;
            return fs.lstat(filePath).then((stats) => {
                if(stats.isFile()) {
                    return fs.readFile(filePath, 'utf8').then(
                        (contents) => ({[fileRelativeUri]: f(filePath, fileRelativeUri, contents)})
                    ).catch((error) => {
                        throw new ProcessFileError(filePath, error);
                    });
                }
                else if(stats.isDirectory()) {
                    return walkDirectory(filePath, f, fileRelativeUri);
                }
                else {
                    return Promise.resolve({});
                }
            });
        })).then((resources) => resources.reduce(
            (resourceMap, resource) => Object.assign(resourceMap, resource), {})
        );
    });
}

export class ProcessFileError extends Error {
    public filePath: string;
    public innerError: Error;
    constructor(filePath: string, innerError: Error) {
        super(`${filePath}: processing error. ${innerError.message || ''}`);
        Object.setPrototypeOf(this, ProcessFileError);

        this.filePath = filePath;
        this.innerError = innerError;
    }
}

export { Hypermedia };
