// import { Processor, Hal, HalUtil, ExtendedResource } from 'hypermedium';

// /** whenever a new resources matches the given profile, 
//  * add it to the index and update the index page.
//  * augments index pages with links to all indexed resources
//  * index pages can be recognized by the profile `/index/{profile}`
//  * links are added with rel "fs:entries"
//  * index pages are automatically indexed, so they can be updated as new entries are indexed
//  */
// // TODO: automatically add curie for fs rels
// // TODO: make indexes pagable, sortable. Allow user to specify embedding rules (e.g. embed first 3 links)
// // TODO: convert all relative links to absolute links if baseUri is provided, in post-processing step?
// // TODO: should profile be automatically added to links if the linked resource has its own _links.profile? makes dependency tree explode!
// export const makeIndex = (profile: Hal.Uri): Processor => {
//     const indexProfile = `/schema/index${profile}`;
//     return {
//         name: `index:${profile}`,
//         fn: (rs) => {
//             if(HalUtil.resourceMatchesProfile(rs.resource, profile, rs.state.baseUri)) {
//                 addToIndex(rs.state.indexes, profile, rs.relativeUri);

//                 // update all indexes that should include this resource
//                 const indexSet = rs.state.indexes.get(indexProfile);
//                 if(indexSet) {
//                     rs.markDirty(Array.from(indexSet));
//                 }

//                 return rs;
//             }
//             else if(HalUtil.resourceMatchesProfile(rs.resource, indexProfile, rs.state.baseUri)) {
//                 // this is an index file
//                 addToIndex(rs.state.indexes, indexProfile, rs.relativeUri);

//                 // add the indexed links to this resource
//                 const indexOptions = {
//                     key: 'title',
//                     ...rs.resource._index
//                 };

//                 const uriSet = rs.state.indexes.get(profile);
//                 const indexLinks = (uriSet? Array.from(uriSet): []).map((href: Hal.Uri) => {
//                     const entry: any = {
//                         href,
//                         profile,
//                         title: rs.calculateFrom(href, ({resource}) => resource && resource.title),
//                     };

//                     // include sorting order key
//                     if(indexOptions.key !== 'title') {
//                         entry[indexOptions.key] = rs.calculateFrom(href, ({resource}) =>
//                             resource && resource[indexOptions.key]);
//                     }

//                     return entry;
//                 });

//                 const resource: ExtendedResource = {
//                     ...rs.resource,
//                     _links: {
//                         'fs:entries': indexLinks,
//                         ...rs.resource._links,
//                     }
//                 };

//                 delete resource._index;

//                 return {
//                     ...rs, 
//                     resource,
//                 };
//             }

//             return rs;
//         }
//     };
// };

// function addToIndex(index: Map<string, Set<Hal.Uri>>, profile: Hal.Uri, uri: Hal.Uri): void {
//     let uriSet = index.get(profile);
//     if(!uriSet) {
//         uriSet = new Set();
//         index.set(profile, uriSet);
//     }

//     uriSet.add(uri);
// }
