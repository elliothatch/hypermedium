import * as Path from 'path';

import * as UriTemplate from 'uri-template';
import * as Url from 'url';

import { match } from 'path-to-regexp';

import * as JsonLD from './json-ld';

/** either a 'dot.separated.path' or array of property names */
export type PropertyPath = string | string[];

/**
 * @returns a copy of the uri pointing to the html version of the resource
 */
export function htmlUri(uri: JsonLD.IRI): JsonLD.IRI {
    const extname = Path.extname(uri);
    if(extname === '.json') {
        return uri.slice(0, -extname.length);
    }
    return uri;
}

export function getTypes(resource: JsonLD.Document): string[] {
    return Array.isArray(resource['@type'])?
        resource['@type']:
        resource['@type'] != undefined?
        [resource['@type']]:
        [];
}

export function matchesType(resource: JsonLD.Document, ldType: JsonLD.LdType): boolean {
    const documentTypes = getTypes(resource);

    return documentTypes.includes(ldType as string);
}

/**
 * Gets a property from an object if it exists. Supports nested properties with dot notation.
 * @param obj - root object
 * @param propertyName - name of the property to retrieved. Nested properties are specified with dot notation ('a.b.c')
 */
export function getProperty(obj: any, propertyName?: PropertyPath): any {
    if(!obj) {
        return obj;
    }

    if(!propertyName) {
        return obj;
    }

    // empty property is identity function
    const properties = Array.isArray(propertyName)? propertyName: propertyName.split('.');

    if(properties.length === 1) {
        return obj[properties[0]];
    }

    return getProperty(obj[properties[0]], properties.slice(1));
}

/**
 * returns all instances of a property, searching all values in any arrays in the property chain
* for example. matchProperty({items: [{name: 'a'}, {name: 'b'}]}, 'items.name') returns ['a', 'b']
* }
 */
export function matchProperty(obj: any, propertyName: PropertyPath): any[] {
    if(!obj) {
        return [];
    }

    const properties = Array.isArray(propertyName)? propertyName: propertyName.split('.');
    const value = obj[properties[0]];
    if(!value) {
        return [];
    }

    const values = Array.isArray(value)? value: [value];

    if(properties.length === 1) {
        return values;
    }

    return values.reduce((arr, v) => arr.concat(matchProperty(v, properties.slice(1))), [] as any[]);
}

/**
 * sets a property on an object. Supports nested properties, creates nested objects when necessary
 * @param obj - root object
 * @param propertyName - name of the property to set. Nested properties are specified with dot notation ('a.b.c') or as an array ['a', 'b', 'c']
 * @param value - the value to set. if undefined, do nothing and don't create nested objects
 * @returns obj
 */
export function setProperty(obj: any, propertyName: PropertyPath | undefined, value: any): any {
    if(!obj) {
        return obj;
    }

    if(!propertyName) {
        return value;
    }

    const properties = Array.isArray(propertyName)? propertyName: propertyName.split('.');

    if(properties.length === 1) {
        obj[properties[0]] = value;
        return obj;
    }

    if(!obj[properties[0]]) {
        obj[properties[0]] = {};
    }
    setProperty(obj[properties[0]], properties.slice(1), value);
    return obj;
}

// TODO: make this work with different MIME types with sensible default beahvior
/**
 * @param baseUri - if uri is a relative IRI (doesn't start with a slash), the baseUri is prepended to the result
 */
export function normalizeUri(uri: JsonLD.IRI, baseUri?: JsonLD.IRI): JsonLD.IRI {
    if(!uri.startsWith('/') && baseUri) {
        uri = baseUri.slice(-1) == '/'?
            baseUri + uri:
            baseUri + '/' + uri;
    }

    const suffix = '.json';
    if(uri.slice(-1) === '/') {
        return `${uri}index${suffix}`;
    }
    else if(uri.lastIndexOf('.') < uri.lastIndexOf('/')) {
        return uri + suffix;
    }
    return uri;
}

/** returns an object containing only the properties listed in 'properties' */
export function pickProperties<T extends {[key: string]: any}>(target: T, properties: PropertyPath[]): Partial<T> {

    return properties.reduce((result, property) => {
        setProperty(result, property, getProperty(target, property));
        return result;
    }, {});
}

/** recursively merge two objects. source values overwrite target values
* arrays are overwritten rather than merged. */
export function mergeObjects<T extends {[key: string]: any}, U extends {[key: string]: any}>(target: T, source: U): T & U {
    Array.from(Object.entries(source)).forEach(([key, value]) => {
        if(typeof value !== 'object' || Array.isArray(value)) {
            target[key as keyof T & U] = value;
            return;
        }

        if(typeof target[key] !== 'object' || Array.isArray(target[key])) {
            // target value is not an object, overwite it with the object
            target[key as keyof T & U] = value;
            return;
        }

        // both values are objects, merge
        mergeObjects(target[key], value);
    });

    return target as T & U;
}
