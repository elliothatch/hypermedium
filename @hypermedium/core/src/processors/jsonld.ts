import { Processor, ResourceState, HypermediaEngine, Hal, HalUtil } from 'hypermedium';

type PropertyPath = HalUtil.PropertyPath;

/**
* Standard processors that operate on a subset of JSON-LD compliant resources, that hypermedium works with.
* all processors are prefixed with `ld:`. this prefix will be removed in future versions when HAL is fully deprecated.
*/

/** Set the '@id' properto to the resource's fully resolved URI */
export const Self: Processor.Definition<'ld:self', {
    /** set a property other than '@id' */
    to?: PropertyPath;
    /** overwrite the value of 'to'/'@id' if the resource already has a value */
    overwrite?: boolean;
} | undefined> = {
        name: 'ld:self',
        onProcess: (rs, options) => {
            const to = options?.to || '@id';

            if(HalUtil.getProperty(rs.resource, to) != undefined && !options?.overwrite) {
                rs.logger.warn(`Property '${to}' has value '${HalUtil.getProperty(rs.resource, to)}', but overwrite is not enabled. Skipping...`);
                return rs.resource;
            }

            HalUtil.setProperty(rs.resource, to, rs.uri);
            return rs.resource;
        }
    };

/** embed a resource or partial resource to the specified property
* TODO: support embedding remote/non-hypermedium resources, enabled by an options flag
*/
export const Embed: Processor.Definition<'ld:embed', {
    /** uri of the resource to embed */
    uri?: Hal.Uri;
    /** property where the resource will be embedded.
* if undefined, embeds directly into the root object (useful for map).
* if uri is not provided, tries to infer the uri.
*  - if the property is a string, use the string as uri
*  - if the property is an object, use the object's '@id' as the uri
* // TODO: to be JSON-LD compliant, we should only infer the uri if the context identifies it as such ("@type": "@id", "@id": "http://schema.org/url")?
* // TODO: support array?
*/
    to?: PropertyPath;
    /** only the listed properties will be included in the embed.
* if undefined, the entire resource is embedded */
    properties?: PropertyPath[];
    /** merge embedded properties with existing ones.
*  - false (default): the entire 'to' value is replaced with the embedded resource
*  - true: original values are preserved if they don't also exist in the embedded resource. nested objects are completely overwritten
*  - 'preserve': original values are preserved and overwite conflicts in the embedded resource. nested objects in the embedded object are completely ignored
*  - 'recursive': same behavior as true, but nested objects are also merged.
*  - 'preserve-recursive': same behavior as 'recursive', but nested objects are also merged.
*/
    merge?: boolean | 'preserve' | 'recursive' | 'preserve-recursive';
} | undefined> = {
        name: 'ld:embed',
        onProcess: (rs, options) => {
            const value = HalUtil.getProperty(rs.resource, options?.to);
            const uri = options?.uri
                || (typeof value === 'string'?
                    value:
                    typeof value === 'object' && !Array.isArray(value)?
                        value['@id']:
                        undefined);

            if(!uri) {
                throw new Error('No URI to embed.');
            }

            const embedResource = rs.getResource(uri);
            if(!embedResource) {
                // TODO: use NotFoundError
                const error = new Error(`Embed resource not found: ${uri}'`);
                (error as any).uri = uri;
                throw error;
            }

            const embed = options?.properties?
                HalUtil.pickProperties(embedResource, options?.properties):
                embedResource;

            switch(options?.merge) {
                case true:
                    rs.resource = HalUtil.setProperty(rs.resource, options?.to, Object.assign(value || {}, embed));
                    return rs.resource;
                case 'preserve':
                    rs.resource = HalUtil.setProperty(rs.resource, options?.to, Object.assign(embed, value));
                    return rs.resource;
                case 'recursive':
                    rs.resource = HalUtil.mergeObjects(value || {}, embed);
                    return rs.resource;
                case 'preserve-recursive':
                    rs.resource = HalUtil.mergeObjects(embed, value || {});
                    return rs.resource;
                default:
                    // overwrite
                    rs.resource = HalUtil.setProperty(rs.resource, options?.to, embed);
                    return rs.resource;
            }
        }
    };

// index will be a dynamic resource, not a processor!
// /** indexes a resource, so all resources of a matching type can be retrieved as a list with 'ld:getIndex' */
// export const Index: Processor.Definition<'ld:index', {
//     /** all resources processed with 'ld:index' that have a value for this property are added to the index.
// * all values in an array are index. additionally, if any part of the propertypath is an array, all elements of each array are searched for matching properties to index.
// * the value of a property match MUST NOT be an object, or contain objects. in this case, the match will be skipped and a warning is emitted */
//     property: PropertyPath;
// }> = {
//         name: 'ld:index',
//         onProcess: (rs, options) => {
//             const matches = HalUtil.matchProperty(rs.resource, options.property);
//             if(matches.length === 0) {
//                 return rs.resource;
//             }

//             matches.forEach((match: any) => {
//                 // convert the match to a string, so it can be serialized as a key
//                 const filterArrayObjects = (value: any[]): any[] => {
//                     return value.reduce((result, v) => {
//                         if(Array.isArray(v)) {
//                             result.push(filterArrayObjects(v));
//                         }
//                         else if(typeof v === 'object') {
//                             rs.logger.warn(`Cannot index object '${JSON.stringify(v)}'. Skipping...`)
//                         }
//                         else {
//                             result.push(v);
//                         }
//                         return result;
//                     }, [] as any[]);
//                 };

//                 if(!Array.isArray(match) && typeof match === 'object') {
//                     rs.logger.warn(`Cannot index object '${JSON.stringify(match)}'. Skipping...`)
//                     return;
//                 }
//                 const matchStr = Array.isArray(match)?
//                     '' + filterArrayObjects(match):
//                     '' + match;

//                 // options.property: 'tags'
//                 // we want to find all pages with tag 'hello'
//                 // Map<string, uri>.get('hello')
//                 // we want to find all pages with any tags
//             });

//             return rs.resource;
//         }
//     };

export const processorDefinitions: Processor.Definition[] = [
    Self,
    Embed,
    // Index,
];

