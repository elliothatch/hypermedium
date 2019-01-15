import * as Path from 'path';
import { promises as fs } from 'fs';
import * as Url from 'url';

import { Observable, Observer } from 'rxjs';

import { NextFunction, Router, Request, Response } from 'express';

import * as HAL from './hal';
import { filterCuries, profilesMatch, resourceMatchesProfile } from './hal-util';
import { walkDirectory } from './util';

/** augments a hypermedia site with dynamic properties and resources
 * for example, adds "self" links and "breadcrumb"
 * dynamic resources like comments can be updated with CRUD actions through hypermedia
 * dynamic tagging
 * use middleware to extend resources that match a certain profile
 */
class Hypermedia {
    public router: Router;
    public state: Hypermedia.State;
    public processors: Hypermedia.Processor[];
    /** maps relative uri to the original resource loaded from the file system */
    public files: Hypermedia.ResourceMap;
    /** should ALWAYS be serializable. nothing fancy in the resources */
    public resources: Hypermedia.ResourceMap;
    /** tracks which resources are currently being processed.
     * used to prevent reprocessing cycles */
    public processing: {[uri: string]: true};
    /** each value is an set of URIs that depend on the object property's URI */
    public dependents: Map<HAL.Uri, Set<HAL.Uri>>;
    /** reverse index of dependents */
    public dependencies: Map<HAL.Uri, Set<HAL.Uri>>;

    public event$: Observable<Hypermedia.Event>;
    protected eventObserver!: Observer<Hypermedia.Event>;

    constructor(options: Hypermedia.Options) {
        this.event$ = new Observable((observer) => {
            this.eventObserver = observer;
        });

        this.state = {
            baseUri: options.baseUri,
            curies: options.curies,
            tags: {},
            indexes: {},
            suffix: options.suffix || '.json',
        };
        this.processors = options.processors;
        this.files = {};
        this.resources = {};
        this.processing = {};
        this.dependents = new Map();
        this.dependencies = new Map();
        this.router = Router();
        this.router.get('/*', this.middleware);
    }

    // pagination:
    // time cursor based, options: skip, limit.

    protected middleware = (req: Request, res: Response, next: NextFunction) => {
        const resource = this.getResource(req.path);
        if(!resource) {
            return next();
        }

        return res.status(200).json(resource);
    }

    protected log(event: Hypermedia.Event): void {
        this.eventObserver.next(event);
    }

    // TODO: make this work with different MIME types with sensible default beahvior
    public normalizeUri(relativeUri: HAL.Uri): HAL.Uri {
        if(relativeUri.slice(-1) === '/') {
            return `${relativeUri}index${this.state.suffix}`;
        }
        return relativeUri;
    }

    public getResource(relativeUri: HAL.Uri): HAL.Resource | undefined {
        if(relativeUri.slice(-1) === '/') {
            return this.resources[this.normalizeUri(relativeUri)] || this.resources[relativeUri];
        }
        else if(relativeUri.lastIndexOf('.') < relativeUri.lastIndexOf('/')) {
            // no file extension, try to find a file with the default suffix
            // TODO: store a set of "suffixes", pick based on Accept header, or use default 'suffix' if missing
            return this.resources[`${relativeUri}${this.state.suffix}`] || this.resources[relativeUri] || this.resources[this.normalizeUri(relativeUri + '/')]
        }
        return this.resources[relativeUri];
    }

    public getByUri<T>(dict: Map<string, T>, relativeUri: HAL.Uri): T | undefined {
        if(relativeUri.slice(-1) === '/') {
            return dict.get(this.normalizeUri(relativeUri)) || dict.get(relativeUri);
        }
        return dict.get(relativeUri);
    }

    public deleteByUri<T>(dict: Map<string, T>, relativeUri: HAL.Uri): boolean;
    public deleteByUri(dict: Set<string>, relativeUri: HAL.Uri): boolean;
    public deleteByUri<T>(dict: Map<string, T> | Set<string>, relativeUri: HAL.Uri): boolean {
        if(relativeUri.slice(-1) === '/') {
            const indexUri = this.normalizeUri(relativeUri);
            if(dict.has(indexUri)) {
                return dict.delete(indexUri);
            }
            else {
                return dict.delete(relativeUri);
            }
        }
        return dict.delete(relativeUri);
    }

    public processResource(relativeUri: HAL.Uri, resource: HAL.Resource): HAL.Resource {
        if(this.processing[relativeUri]) {
            return resource;
        }

        this.processing[relativeUri] = true;
        const dependencies = new Set<HAL.Uri>();
        const dirtyResources = new Set<HAL.Uri>();

        // TODO: figure out the normalized uri mess
        const result = this.processors.reduce(
            (d, processor) => {
                return processor({
                    ...d, 
                    calculateFrom: (dependencyUri: HAL.Uri | HAL.Uri[], fn: Hypermedia.CalculateFromResourceFn): any => {
                        if(Array.isArray(dependencyUri)) {
                            dependencyUri
                                .filter((uri) => this.normalizeUri(uri) !== relativeUri)
                                .forEach((uri) => dependencies.add(uri));
                            return fn(dependencyUri.map((uri) => this.getResource(uri)));
                        } else if(this.normalizeUri(dependencyUri) !== relativeUri) {
                            dependencies.add(this.normalizeUri(dependencyUri));
                            return fn(this.getResource(dependencyUri));
                        }
                    },
                    markDirty: (uri: HAL.Uri | HAL.Uri[]) => (
                        (Array.isArray(uri)?
                            uri:
                            [uri]
                        ).forEach((u) => dirtyResources.add(u))
                    )
                });
            }, {resource, relativeUri, state: this.state});

        this.state = result.state;
        this.resources[relativeUri] = result.resource;

        // delete old dependency relationships
        const oldDependencies = this.getByUri(this.dependencies, relativeUri);
        if(oldDependencies) {
            oldDependencies.forEach((uri) => {
                const dependents = this.getByUri(this.dependents, uri)!;
                this.deleteByUri(dependents, relativeUri);
                if(dependents.size === 0) {
                    this.deleteByUri(dependents, uri);
                }
            });
        }

        // add new dependency relationships
        dependencies.forEach((uri) => {
            const dependents = this.getByUri(this.dependents, uri) || new Set();
            dependents.add(relativeUri);
            this.dependents.set(uri, dependents);
        });
        if(dependencies.size > 0) {
            this.dependencies.set(relativeUri, dependencies);
        }

        // reprocess dependent resources
        const dependents = this.getByUri(this.dependents, relativeUri);
        const allDependents = new Set();
        if(dependents) {
            dependents.forEach((uri) => allDependents.add(uri));
        }
        dirtyResources.forEach((uri) => allDependents.add(uri));
        this.reprocessResources(Array.from(allDependents.values()));

        this.log({
            type: 'ProcessResource',
            dependencies,
            dependents: allDependents,
            relativeUri,
            resource: result.resource,
        });

        delete this.processing[relativeUri];
        return this.getResource(relativeUri)!;
    }

    /** recursively process files in a directory */
     public processDirectory(directoryPath: string, relativeUri: HAL.Uri = ''): Promise<Hypermedia.ResourceMap> {
         return walkDirectory(
             directoryPath,
             (filePath: string, uri: string, fileContents: string) => {
                 //  parse twice so we have two distinct copies
                 this.files[uri] = JSON.parse(fileContents);
                 return this.processResource(uri, JSON.parse(fileContents));
             },
             relativeUri,
         );
     }

    /** reprocesses the resource identified by each URI using the original version
     * of the resource from the file system */
    public reprocessResources(relativeUris: HAL.Uri[]): HAL.Resource[] {
        return relativeUris.reduce((resources, relativeUri) => {
            if(this.files[relativeUri]) {
                resources.push(this.processResource(
                    relativeUri,
                    JSON.parse(JSON.stringify(this.files[relativeUri])), // lazy deep clone
                ));
            }
            return resources;
        }, [] as HAL.Resource[]);
    }
}

namespace Hypermedia {
    export interface Options {
        /** if provided, this string prefixes the "href" property on all all site-local links. e.g. "https://example.com" */
        baseUri?: string;
        curies: HAL.Curie[];
        processors: Processor[];
        /** resource suffix e.g. `.json`. you must include the first period (.) */
        suffix?: string;
    }

    /** Dynamically calculated properties of the hypermedia site. */
    export interface State {
        baseUri?: HAL.Uri;
        curies: HAL.Curie[];
        /** maps tag name to list of URIs that contain this tag */
        tags: {[tag: string]: HAL.Uri[]};
        /** maps profiles to list of hrefs that have that profile */
        indexes: {[profile: string]: HAL.Uri[]};
        suffix: string;
    }

    export interface ExtendedResource extends HAL.Resource {
        [uri: string]: any;
    }

    export interface ResourceState<R extends HAL.Resource = ExtendedResource, S extends State = State> {
        resource: R;
        relativeUri: string;
        state: S;
        /** call this function to calculate values based on other resources.
         * has the side-effect of letting the processing engine know to reprocess this file
         * whenever the dependency changes.
         * if a resource is not found, it is replaced with `undefined`
         */
        calculateFrom: CalculateFromResource;
        markDirty: (relativeUri: HAL.Uri | HAL.Uri[]) => void;
    }

    export type CalculateFromResource = {
        (relativeUri: HAL.Uri, fn: CalculateFromResourceFn ): any;
        (relativeUri: Array<HAL.Uri>, fn: CalculateFromResourceFn): any;
    };
    export type CalculateFromResourceFn = {
        (r?: HAL.Resource): any;
        (r: Array<HAL.Resource | undefined>): any;
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
                        self: {href: rs.state.baseUri? Url.resolve(rs.state.baseUri, rs.relativeUri): rs.relativeUri}
                    }, rs.resource._links)
                })
            })
        );

        // TODO: detect rels that use curies that haven't been defined
        // TODO: record local curie rels so we can generate warnings for rels that have no documentation resource */
        export const curies = (rs: ResourceState): ResourceState => {
            const matchedCuries = filterCuries(rs.state.curies, Object.keys(rs.resource._links || {}));
            return matchedCuries.length === 0?
                rs:
                { ...rs, resource: {
                    ...rs.resource, _links: {
                        curies: matchedCuries,
                        ...rs.resource._links,
                }}};
        };

        export const tags = (rs: ResourceState): ResourceState => {
            const tags = getTags(rs.resource);
            tags.forEach((t) => {
                if(!rs.state.tags[t.href]) {
                    rs.state.tags[t.href] = [];
                }
                rs.state.tags[t.href].push(rs.relativeUri);
            });

            rs.markDirty(tags.map((t) => t.href));
            return rs;
        };

        // This is kind of useless... these kinds of additions should be part of the HTML renderer
        // we should assume HAL client knows how to walk up the resource tree
        export const breadcrumb = (rs: ResourceState): ResourceState => {
            const uriParts = rs.relativeUri.split('/').slice(0, -1);
            rs.resource._links = Object.assign({
                'fs:breadcrumb': (uriParts.length === 0)? undefined:
                    uriParts.map((uriPart, i) => {
                        const href = '/' + uriParts.slice(1, i+1).join('/');
                        return {
                            href,
                            title: rs.calculateFrom(href, (r: any) => { return r && r.title;}),
                        };
                    })
            }, rs.resource._links);
            return rs;
        };

    }

    /** whenever a new resources matches the given profile, 
     * add it to the index and update the index page.
     * augments index pages with links to all indexed resources
     * index pages can be recognized by the profile `/index/{profile}`
     * links are added with rel "fs:entries"
     * index pages are automatically indexed, so they can be updated as new entries are indexed
     */
    // TODO: automatically add curie for fs rels
    // TODO: make indexes pagable, sortable. Allow user to specify embedding rules (e.g. embed first 3 links)
    // TODO: convert all relative links to absolute links if baseUri is provided, in post-processing step?
    // TODO: should profile be automatically added to links if the linked resource has its own _links.profile? makes dependency tree explode!
    export const makeIndex = (profile: HAL.Uri): Processor => {
        const indexProfile = `/schema/index${profile}`;
        return (rs) => {
            if(resourceMatchesProfile(rs.resource, profile, rs.state.baseUri)) {
                const index = rs.state.indexes[profile] || [];
                if(index.indexOf(rs.relativeUri) === -1) {
                    index.push(rs.relativeUri);
                    rs.state.indexes[profile] = index;
                }

                rs.markDirty(rs.state.indexes[indexProfile]);
                return rs;
            }
            else if(resourceMatchesProfile(rs.resource, indexProfile, rs.state.baseUri)) {
                const index = rs.state.indexes[indexProfile] || [];
                if(index.indexOf(rs.relativeUri) === -1) {
                    index.push(rs.relativeUri);
                    rs.state.indexes[indexProfile] = index;
                }

                return { ...rs, 
                    resource: {
                    ...rs.resource, _links: {
                        'fs:entries': (rs.state.indexes[profile] || []).map((href: HAL.Uri) => ({
                            href,
                            profile,
                            title: rs.calculateFrom(href, (r: any) => { return r && r.title;}),
                        })),
                        ...rs.resource._links,
                }}};
            }

            return rs;
        };
    };

    /* higher-order processor that only runs the provided processor if the resource matches the designated profile */
    export const matchProfile = (profile: HAL.Uri, processor: Processor): Processor => {
        return (rs) => resourceMatchesProfile(rs.resource, profile, rs.state.baseUri)?
            processor(rs):
            rs;
    };


    /** get all "tag" links, or empty array */
    function getTags(resource: HAL.Resource): HAL.Link[] {
        let tags = resource._links && resource._links.tag;
        if(!tags) {
            return [];
        }

        if(!Array.isArray(tags)) {
            tags = [tags];
        }
        return tags;
    }

    export type Event = Event.ProcessResource;
    export namespace Event {
        export interface ProcessResource {
            type: 'ProcessResource'

            relativeUri: HAL.Uri;
            dependents: Set<HAL.Uri>;
            dependencies: Set<HAL.Uri>;
            resource: HAL.Resource;
        }
    }
}

export { Hypermedia };
