import { Hal, HypermediaEngine, ExtendedResource } from 'freshr';

/**
 * add resources to the "_embedded" property for each rel in the "_embed" property. Then remove "_embed"
 * Also removes "_links" entries for embedded resources
 * TODO: detect curies in "embed" and add them? include "_embedded" curies by default? lift "_embedded" curies to root?
 * TODO: resolve hrefs correctly even if they aren't the full uri (e.g. /posts doesn't work but /posts/index.json does)
 * TODO: put "title" in embedded "_links" into the "self" link in the embedded cocument? it's annoying that the title no longer works correctly when linking to embedded document
 */
export function embed(rs: HypermediaEngine.ResourceState): HypermediaEngine.ResourceState {
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
        }).filter((r?: Hal.Resource) => !!r);

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
}


export type Embed = {[rel: string]: EmbedEntry};
export interface EmbedEntry {
    /** URIs of resources to embed. If omitted or fewer than "max", uses hrefs from the resource's _links property. */
    href?: Hal.Uri | Hal.Uri[];
    /** maximum number of entries to embed */
    max?: number;
    /** allows recursive inclusion of embedded resources. e.g. with value 1, each embedded resource will also contain its own "_embedded" property */
    depth?: number;
    /** if provided, only embed the specified properties */
    properties?: string[];
}
