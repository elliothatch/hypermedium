import { HelperDelegate, SafeString  } from 'handlebars';
import * as Moment from 'moment';
import { HalUtil } from 'hypermedium';

const handlebarsHelpers: {[name: string]: HelperDelegate} = {
    'not': (lhs) => !lhs,
    'eq': (lhs, rhs) => lhs == rhs,
    'or': (lhs, rhs) => lhs || rhs,
    'and': (lhs, rhs) => lhs && rhs,
    'startsWith': (str, seq) => str.startsWith(seq),
    'isArray': (val) => Array.isArray(val),
    'typeof': (val) => typeof val,
    'json': (val) => JSON.parse(val),
    'json-stringify': (val) => new SafeString(JSON.stringify(val)),
    'html-uri': HalUtil.htmlUri,
    'expandCuri': HalUtil.expandCuri,
    'datetime': (dateStr, formatStr) => {
        const format = (formatStr && typeof formatStr === 'string')?
            formatStr:
            'MMMM D, YYYY [at] h:mm a z';

        const date = Moment(dateStr);
		return new SafeString('<time datetime="' + date.toISOString() + '">' + date.format(format) + '</time>');
    },
    /**
     * renders the link as an anchor tag. automatically expands curies based on the root resource. to use a different resource to resolve the curi, pass it as the third parameter
     * TODO: this doesn't work with link arrays.
     * TODO: add option to not use html-link shortening
     */
    'hal-link': (rel, link, ...options) => {
        let resource = options[0];
        if(options.length === 1) {
            // no resource provided, use the root resource
            resource = options[0].data.root;
        }

        const relHtml = typeof rel === 'string'? `rel=${HalUtil.expandCuri(resource, rel)}`: '';

        return new SafeString(`<a ${relHtml} href=${HalUtil.htmlUri(link.href)}>${link.title || link.href}</a>`)
    },
    'replace': (str: string, regex: string, newValue: string) => new SafeString(str.replace(new RegExp(regex), newValue)),
};

export { handlebarsHelpers };
