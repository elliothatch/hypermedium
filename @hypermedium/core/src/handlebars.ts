import { HelperDelegate, SafeString } from 'handlebars';
import * as Moment from 'moment';
import { JsonLDUtil } from 'hypermedium';

const handlebarsHelpers: {[name: string]: HelperDelegate} = {
    'not': (lhs) => !lhs,
    'eq': (lhs, rhs) => lhs == rhs,
    'or': (lhs, rhs) => lhs || rhs,
    'and': (lhs, rhs) => lhs && rhs,
    'lt': (lhs, rhs) => lhs < rhs,
    'gt': (lhs, rhs) => lhs > rhs,
    'lte': (lhs, rhs) => lhs <= rhs,
    'gte': (lhs, rhs) => lhs >= rhs,
    /** return first truthy argument */
    'coalesce': (...args) => args.slice(0, -1).find(i => !!i),
    'startsWith': (str, seq) => str.startsWith(seq),
    'isArray': (val) => Array.isArray(val),
    'typeof': (val) => typeof val,
    'json': (val) => JSON.parse(val),
    'range': (start, stop, step) => {
        if(typeof start !== 'number') {
            start = 0;
        }
        if(typeof stop !== 'number') {
            stop = start;
            start = 0;
        }
        if(typeof step !== 'number') {
            step = 1;
        }

        return Array.from({length: Math.floor(Math.abs(start-stop)/Math.abs(step))}, (x, i) => (i*step + start))
    },
    'matchesType': function(ldType) {
        return JsonLDUtil.matchesType(this, ldType)
    },
    /** creates a link from a json-ld object. tries to use url, falls back to @id */
    'link': (resource, rel, target, ...options) => {
        const url = resource?.url || resource?.['@id'];
        if(!url) {
            throw new Error(`handlebars helper link (core): invalid link: 'url' and '@id' were '${url}'`);
        }
        const relHtml = typeof rel === 'string'? `rel=${rel}`: '';

        if(typeof target == 'string') {
            return new SafeString(`<a ${relHtml} href=${JsonLDUtil.htmlUri(url)} target=${target}>${resource.headline || resource.name || url}</a>`)
        }

            return new SafeString(`<a ${relHtml} href=${JsonLDUtil.htmlUri(url)}>${resource.headline || resource.name || url}</a>`)
    },

    /** creates a shallow copy of the object and sets/overwrites top-level properties with the provided values */
	'extend': (target, context) => {
	    return {
	        ...target,
	        ...context,
        };
	},
	// 'extend-context': function(context, options) {
		// return options.fn(Object.assign(Object.assign({}, this), JSON.parse(context)));
	// },
    'json-stringify': (val, space) => JSON.stringify(val, null, space),
    'json-stringify-safe': (val, space) => new SafeString(JSON.stringify(val, null, space)),
    'html-uri': JsonLDUtil.htmlUri,
    'getTypes': JsonLDUtil.getTypes,
    'datetime': (dateStr, formatStr) => {
        const format = (formatStr && typeof formatStr === 'string')?
            formatStr:
            dateStr.includes('T')?
            'MMMM D, YYYY [at] h:mm a z':
            'MMMM D, YYYY';

        const date = Moment(dateStr);
		return new SafeString('<time datetime="' + date.toISOString() + '">' + date.format(format) + '</time>');
    },
    'get': (key, map) => map[key],
    'replace': (str: string, regex: string, newValue: string) => new SafeString(str.replace(new RegExp(regex), newValue)),
    'find': (array, value, key) => {
        array = (Array.isArray(array)? array: [array])
        return array.find( (v: any) =>
            key? JsonLDUtil.getProperty(v, key) === value: v === value);
    },
    'join': (array, value) => {
        return Array.isArray(array)?
            array.join(value):
            array;
    },
    /** pick an value off each object in the array */
    'map-pick': (key, array) => {
        return array.map((e: any) => e[key]);
    },
    'repeat': function(count, options) {
        return options.fn(this).repeat(count);
    },
    /** converts a single value to an array containing one item. leaves array as-is. null/undefined returns an empty array */
    'asArray': (value) => {
        return value == undefined?
            []:
            Array.isArray(value)? value: [value];
    },
    'stripEmptyLines': (value) => {
        return value.replace(/^\s*\n/gm, '');
    },
    'concat': (lhs, rhs) => {
        if(Array.isArray(lhs)) {
            return lhs.concat(rhs);
        }

        return lhs + rhs;
    },
    'slice': (value, start, end) => {
        if(typeof start !== 'number') {
            start = undefined;
        }
        if(typeof end !== 'number') {
            end = undefined;
        }
        return value.slice(start, end);
    },
    'add': (lhs, rhs) => {
        return lhs + rhs
    },
    'subtract': (lhs, rhs) => {
        return lhs - rhs
    },
    'multiply': (lhs, rhs) => {
        return lhs * rhs
    },
    'divide': (lhs, rhs) => {
        return lhs / rhs
    }
};

export { handlebarsHelpers };
