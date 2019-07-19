import { Hypermedia, Processor, HAL, resourceMatchesProfile } from 'freshr';

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
    return {
        name: `index:${profile}`,
        fn: (rs) => {
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
        }
    };
};
