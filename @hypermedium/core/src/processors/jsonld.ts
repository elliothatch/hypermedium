import { Processor, ResourceState, HypermediaEngine, JsonLD, JsonLDUtil } from 'hypermedium';

type PropertyPath = JsonLDUtil.PropertyPath;

/**
* Standard processors that operate on a subset of JSON-LD compliant resources, that hypermedium works with.
* all processors are prefixed with `ld:`. this prefix will be removed in future versions when HAL is fully deprecated.
*/

/** Set the '@id' properto to the resource's fully resolved URI */
export const Self: Processor.Definition<'self', {
    /** set a property other than '@id' */
    to?: PropertyPath;
    /** overwrite the value of 'to'/'@id' if the resource already has a value */
    overwrite?: boolean;
} | undefined> = {
        name: 'self',
        onProcess: (rs, options) => {
            const to = options?.to || '@id';

            if(JsonLDUtil.getProperty(rs.resource, to) != undefined && !options?.overwrite) {
                rs.logger.warn(`Property '${to}' has value '${JsonLDUtil.getProperty(rs.resource, to)}', but overwrite is not enabled. Skipping...`);
                return rs.resource;
            }

            // TODO: add options for extension
            // TODO: use resourceExtensions from module
            // TODO: use uri normalizer util function
            const uri = rs.uri.endsWith('/index.json')?
                rs.uri.substring(0, rs.uri.lastIndexOf('/index.json')):
                rs.uri.endsWith('.json')?
                rs.uri.substring(0, rs.uri.lastIndexOf('.json')):
                rs.uri;
            JsonLDUtil.setProperty(rs.resource, to, uri);
            return rs.resource;
        }
    };

/** embed a resource or partial resource to the specified property
* TODO: support embedding remote/non-hypermedium resources, enabled by an options flag
*/
export const Embed: Processor.Definition<'embed', {
    /** uri of the resource to embed */
    uri?: JsonLD.IRI;
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
        name: 'embed',
        onProcess: (rs, options) => {
            const value = JsonLDUtil.getProperty(rs.resource, options?.to);
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
                JsonLDUtil.pickProperties(embedResource, options?.properties):
                embedResource;

            switch(options?.merge) {
                case true:
                    rs.resource = JsonLDUtil.setProperty(rs.resource, options?.to, Object.assign(value || {}, embed));
                    return rs.resource;
                case 'preserve':
                    rs.resource = JsonLDUtil.setProperty(rs.resource, options?.to, Object.assign(embed, value));
                    return rs.resource;
                case 'recursive':
                    rs.resource = JsonLDUtil.mergeObjects(value || {}, embed);
                    return rs.resource;
                case 'preserve-recursive':
                    rs.resource = JsonLDUtil.mergeObjects(embed, value || {});
                    return rs.resource;
                default:
                    // overwrite
                    rs.resource = JsonLDUtil.setProperty(rs.resource, options?.to, embed);
                    return rs.resource;
            }
        }
    };

/** reorders an array, placing elements with matching values at the beginning of the array, then leaving the rest as-is */
export const Order: Processor.Definition<'order', {
    property?: PropertyPath;
    key?: PropertyPath;
    values: any[];
}> = {
        name: 'order',
        onProcess: (rs, options) => {
        const array = JsonLDUtil.getProperty(rs.resource, options?.property);

        if(!Array.isArray(array)) {
            rs.logger.warn(`skipping order: '${options?.property}' must be an array`);
            return rs.resource;
        }

        array.sort((a: any, b: any) => {
            const aVal = JsonLDUtil.getProperty(a, options?.key);
            const bVal = JsonLDUtil.getProperty(b, options?.key);

            const aIndex = options.values.indexOf(aVal);
            const bIndex = options.values.indexOf(bVal);

            if(aIndex < 0 && bIndex >= 0) {
                return 1;
            }
            if(aIndex >= 0 && bIndex < 0) {
                return -1;
            }

            return aIndex - bIndex;
        });

        rs.resource = JsonLDUtil.setProperty(rs.resource, options?.property, array);

        return rs.resource;
        }
    };

// export const GetIndex: Processor.Definition<'getIndex', {
//     /**  */
//     property: PropertyPath;
// } | undefined> = {
//         name: 'getIndex',
//         onProcess: (rs, options) => {
//             return rs.resource;
//         }
//     };


export const processorDefinitions: Processor.Definition[] = [
    Self,
    Embed,
    Order,
    // GetIndex,
];

