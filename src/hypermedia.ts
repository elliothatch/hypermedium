import * as Path from 'path';
import { promises as fs } from 'fs';
import * as Url from 'url';

import { Observable, Observer } from 'rxjs';

import { NextFunction, Router, Request, Response } from 'express';
import { Graph, Edge } from 'graphlib';

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
    public files: {[uri: string]: string};

    /** each loaded resource is stored in the graph, and dependencies between resources are tracked here */
    public resourceGraph: Graph;

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
        this.files = {};
        this.processors = options.processors;
        this.resourceGraph = new Graph();
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
            const node = this.resourceGraph.node(this.normalizeUri(relativeUri) || this.resourceGraph.node(relativeUri));
            return node && (node.resource || node.originalResource);
        }
        else if(relativeUri.lastIndexOf('.') < relativeUri.lastIndexOf('/')) {
            // no file extension, try to find a file with the default suffix
            // TODO: store a set of "suffixes", pick based on Accept header, or use default 'suffix' if missing
            const node = this.resourceGraph.node(`${relativeUri}${this.state.suffix}`) || this.resourceGraph.node(relativeUri) || this.resourceGraph.node(this.normalizeUri(relativeUri + '/'));
            return node && (node.resource || node.originalResource);

        }
        const node = this.resourceGraph.node(relativeUri);
        return node && (node.resource || node.originalResource);
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

    /**
     * @param processor - the processor that formed the dependency
     * @returns true if the dependency did not exist before for this processor
     */
    protected addDependency(relativeUriSource: HAL.Uri, relativeUriTarget: HAL.Uri, processor: Hypermedia.Processor): boolean {
        const edge: ResourceEdge | undefined = this.resourceGraph.edge(relativeUriSource, relativeUriTarget);
        if(!edge) {
            this.resourceGraph.setEdge(relativeUriSource, relativeUriTarget, {
                processors: [processor]
            });
            return true;
        }

        if(!edge.processors.find((p) => processor === p)) {
            edge.processors.push(processor);
            return true;
        }

        return false;
    }

    public loadResource(relativeUri: HAL.Uri, resource: HAL.Resource): HAL.Resource {
        const normalizedUri = this.normalizeUri(relativeUri);
        if(this.resourceGraph.hasNode(normalizedUri)) {
            throw new Error(`Resource ${normalizedUri} already loaded`);
        }
        this.resourceGraph.setNode(normalizedUri, {
            originalResource: resource,
            processing: false
        });

        // console.log('load', normalizedUri);

        return resource;
    }

    public processResource(relativeUri: HAL.Uri): HAL.Resource {
        const normalizedUri = this.normalizeUri(relativeUri);
        const node: ResourceNode | undefined = this.resourceGraph.node(normalizedUri);
        if(!node) {
            console.log(`Resource ${normalizedUri} has not been loaded, skipping`);
            return {};
            // throw new Error(`Resource ${normalizedUri} has not been loaded`);
        }

        if(node.processing) {
            console.log(`Resource ${normalizedUri} is already being processed, skipping`);
            return node.resource!;
            // throw new Error(`Resource ${normalizedUri} is already being processed`);
        }

        node.processing = true;

        // reset dependencies
        const oldDependencies = this.resourceGraph.nodeEdges(normalizedUri) as Edge[];
        oldDependencies
            .filter(({v, w}) => v === normalizedUri)
            .forEach(({v, w}) => this.resourceGraph.removeEdge(v, w));

        // TODO: figure out the normalized uri mess
        const result = this.processors.reduce(
            (d, processor) => {
                return processor({
                    ...d, 
                    calculateFrom: (dependencyUri: HAL.Uri | HAL.Uri[], fn: Hypermedia.CalculateFromResourceFn | Hypermedia.CalculateFromResourcesFn): any => {
                        const dependencyUris = Array.isArray(dependencyUri)? dependencyUri: [dependencyUri];
                        // process dependencies
                        const dependencyResourceParams: Hypermedia.CalculateFromResourceParams[] = dependencyUris.map((uri) => {
                            const normalizedDependencyUri = this.normalizeUri(uri);
                            const dependencyResource: ResourceNode = this.resourceGraph.node(normalizedDependencyUri);
                            if(!dependencyResource) {
                                throw new Error("Resource ${normalizedDependencyUri} has not been loaded");
                            }

                            if(normalizedDependencyUri !== normalizedUri) {
                                this.addDependency(normalizedUri, normalizedDependencyUri, processor);

                                if(!dependencyResource.resource) {
                                    this.processResource(normalizedDependencyUri);
                                }
                            }

                            return {href: normalizedDependencyUri, resource: dependencyResource.resource};
                        });

                        return Array.isArray(dependencyUri)?
                            (fn as Hypermedia.CalculateFromResourcesFn)(dependencyResourceParams):
                            (fn as Hypermedia.CalculateFromResourceFn)(dependencyResourceParams[0]);
                    },
                    markDirty: (uri: HAL.Uri | HAL.Uri[]) => {
                        return (Array.isArray(uri)?
                            uri:
                            [uri]
                        ).forEach((u) => this.addDependency(this.normalizeUri(u), normalizedUri, processor))
                    }
                });
            }, {resource: node.originalResource, relativeUri: normalizedUri, state: this.state});

        this.state = result.state;
        node.resource = result.resource;

        this.log({
            type: 'ProcessResource',
            edges: this.resourceGraph.nodeEdges(normalizedUri) as Edge[],
            relativeUri,
            resource: result.resource,
        });

        node.processing = false;

        // reprocess dependent resources
        (this.resourceGraph.nodeEdges(normalizedUri) as Edge[])
            .filter(({v, w}) => v !== normalizedUri)
            .forEach(({v, w}) => this.processResource(v));

        return node.resource;
    }

    /** processes each loaded resource that has not already been processed */
    public processLoadedResources() {
        this.resourceGraph.nodes()
            .filter((uri) => !this.resourceGraph.node(uri).resource)
            .forEach((uri) => {
                // check if this resource was processed as a dependency
                if(!this.resourceGraph.node(uri).resource) {
                    // console.log('processing', uri);
                    this.processResource(uri)
                }
            });
    }

    /** recursively load files in a directory */
     public loadDirectory(directoryPath: string, relativeUri: HAL.Uri = ''): Promise<Hypermedia.ResourceMap> {
         return walkDirectory(
             directoryPath,
             (filePath: string, uri: string, fileContents: string) => {
                 this.files[uri] = fileContents;
                 if(Path.extname(filePath) === '.json') {
                     return this.loadResource(uri, JSON.parse(fileContents));
                 }
                 // TODO: don't return empty resource
                 return {};
             },
             relativeUri,
         );
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
        (relativeUri: HAL.Uri, fn: CalculateFromResourceFn): any;
        (relativeUri: Array<HAL.Uri>, fn: CalculateFromResourcesFn): any;
    };

    export type CalculateFromResourceFn = (r: CalculateFromResourceParams) => any;
    export type CalculateFromResourcesFn = (r: Array<CalculateFromResourceParams>) => any;

    export type CalculateFromResourceParams = {href: HAL.Uri, resource?: ExtendedResource};

    export type ResourceMap = {[uri: string]: HAL.Resource};

    /** takes in a HAL object and some external state, and returns transformed versions
     * of each. */
    export type Processor = (rs: ResourceState) => ResourceState;

    export namespace Processor {
        export const self = (rs: ResourceState): ResourceState => (
            Object.assign(rs, {
                resource: Object.assign(rs.resource, {
                    _links: Object.assign({
                        // self: {href: rs.state.baseUri? Url.resolve(rs.state.baseUri, rs.relativeUri): rs.relativeUri}
                        self: {href: rs.relativeUri}
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

        export const breadcrumb = (rs: ResourceState): ResourceState => {
            const uriParts = rs.relativeUri.split('/').slice(0, -1);
            rs.resource._links = Object.assign({
                'fs:breadcrumb': (uriParts.length === 0)? undefined:
                    uriParts.map((uriPart, i) => {
                        const href = '/' + uriParts.slice(1, i+1).join('/');
                        return {
                            href,
                            title: rs.calculateFrom(href, ({resource}) => { return resource && resource.title;}),
                        };
                    })
            }, rs.resource._links);
            return rs;
        };

        /**
         * add resources to the "_embedded" property for each rel in the "_embed" property. Then remove "_embed"
         * Also removes "_links" entries for embedded resources
         * TODO: detect curies in "embed" and add them? include "_embedded" curies by default? lift "_embedded" curies to root?
         * TODO: resolve hrefs correctly even if they aren't the full uri (e.g. /posts doesn't work but /posts/index.json does)
         * TODO: put "title" in embedded "_links" into the "self" link in the embedded cocument? it's annoying that the title no longer works correctly when linking to embedded document
         */
        export const embed = (rs: ResourceState): ResourceState => {
            const _embed: Embed = rs.resource._embed;
            if(!_embed) {
                return rs;
            }

            let resource = Object.assign({}, rs.resource);

            const embedded = Object.keys(_embed).reduce((embedded, embedRel) => {
                const embedEntry = _embed[embedRel];

                // collect hrefs to embed
                const embedHrefs = embedEntry.href && (Array.isArray(embedEntry.href)? embedEntry.href: [embedEntry.href]) || [];

                const links = rs.resource._links && rs.resource._links[embedRel];
                const linkHrefs = links && (Array.isArray(links)? links: [links]).map((link) => link.href) || [];

                let hrefs = embedHrefs.concat(linkHrefs);
                let linkHrefsUsed = linkHrefs.length;
                if(embedEntry.max) {
                    // embed hrefs are always used first, and linkHrefs are used in order, so we can easily calculate how many link hrefs were used (and should be deleted)
                    linkHrefsUsed = Math.max(0, linkHrefs.length - Math.max(0, hrefs.length - embedEntry.max));
                    hrefs = hrefs.slice(0, embedEntry.max);
                }

                embedded[embedRel] = rs.calculateFrom(hrefs, (resourceParams) => {
                    return resourceParams.map(({resource: r, href}) => {
                        // TODO: do something reasonable if the document to embed does not exist
                        if(!r) {
                            return r;
                        }

                        // TODO: implement depth
                        if(embedEntry.properties) {
                            return Object.assign(
                                // always include the "self" link
                                {_links: {self: r._links && r._links.self || href}},
                                embedEntry.properties.reduce((obj, property) => {
                                if(property in r) {
                                    obj[property] = r[property];
                                }
                                return obj;
                            }, {} as ExtendedResource));
                        }
                        return r;
                    });
                }).filter((r?: HAL.Resource) => !!r);

                // special case: if we got the href from a non-array "_link" entry, and there were no additional hrefs in "_embed", don't make the embedded resource an array.
                // this simplifies template code when you were only expecting a single link
                if(linkHrefs.length === 1 && embedded[embedRel].length === 1) {
                    embedded[embedRel] = embedded[embedRel][0];
                }

                // delete links that were embedded
                // TODO: don't delete links to resources that couldnt' be loaded?
                if(linkHrefsUsed > 0) {
                    if(!Array.isArray(links) || linkHrefsUsed === links.length) {
                        delete resource._links![embedRel];
                    }
                    else {
                        resource._links![embedRel] = links.slice(linkHrefsUsed);
                    }
                }

                return embedded;
            }, {} as any);

            delete resource._embed;

            return Object.assign(rs, {
                resource: Object.assign(resource, {_embedded: embedded})
            });
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

                if(rs.state.indexes[indexProfile]) {
                    rs.markDirty(rs.state.indexes[indexProfile]);
                }
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
                            title: rs.calculateFrom(href, ({resource}) => { return resource && resource.title;}),
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
            edges: Edge[];
            resource: HAL.Resource;
        }
    }
}

export interface ResourceNode {
    /** the parsed resource before any processing has been applied */
    originalResource: Hypermedia.ExtendedResource;
    /** the processed resource that will be served to the user
     * should ALWAYS be serializable. nothing fancy in the resources */
    resource?: Hypermedia.ExtendedResource;
    /** true if the resource is currently being processed */
    processing: boolean;
}

export interface ResourceEdge {
    processors: Hypermedia.Processor[];
}

export type Embed = {[rel: string]: EmbedEntry};
export interface EmbedEntry {
    /** URIs of resources to embed. If omitted or fewer than "max", uses hrefs from the resource's _links property. */
    href?: HAL.Uri | HAL.Uri[];
    /** maximum number of entries to embed */
    max?: number;
    /** allows recursive inclusion of embedded resources. e.g. with value 1, each embedded resource will also contain its own "_embedded" property */
    depth?: number;
    /** if provided, only embed the specified properties */
    properties?: string[];
}

export { Hypermedia };
