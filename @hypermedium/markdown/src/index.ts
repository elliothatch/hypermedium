import { promisify } from 'util';

import { Plugin, Processor, JsonLDUtil } from 'hypermedium';
import { Marked, MarkedOptions, MarkedExtension} from 'marked';
const GithubSlugger = require('github-slugger');

const markdownPlugin: Plugin = {
    name: 'markdown',
    version: '1.0.0',
    pluginApi: '1',
    dependencies: [],
    basePath: '../',
    moduleFactory: (pluginOptions: Partial<MarkdownPluginOptions>) => {
        let slugger = new GithubSlugger();
        let tocEntries: TableOfContentsEntry[] = [];
        const tocGeneratorExtension: MarkedExtension = {
            hooks: {
                preprocess(src) {
                    slugger = new GithubSlugger();
                    return src;
                },
                // required due to upstream typing error?
                postprocess(html) {
                    return html
                }
            },
            renderer: {
                heading: (text, level, raw) => {
                    raw = raw.toLowerCase().trim().replace(/<[!\/a-z].*?>/ig, '');
                    const id = slugger.slug(raw);
                    tocEntries.push({
                        level,
                        id,
                        text
                    });
                    // don't modify the HTML generated
                    return false;
                }
            }
        };

        const extensions = (pluginOptions?.extensions || []).concat([tocGeneratorExtension]);
        const marked = new Marked(...extensions);

        return {
            hypermedia: {
                processorDefinitions: [{
                    name: 'markdown',
                    onProcess: (rs, options: MarkdownOptions) => {
                        // always use async
                        const parseOptions = {
                            ...options.markedOptions,
                            async: true
                        };

                        if(options.tableOfContents) {
                            tocEntries = [];
                        }

                        return (marked.parse(JsonLDUtil.getProperty(rs.resource, options.from), parseOptions) as Promise<string>).then((html) => {
                            if(options.tableOfContents) {
                                const prefix = options.tableOfContents.prefix || '';
                                // flat toc
                                const toc = {
                                    "@type": [
                                        "/schema/TableOfContents",
                                        "https://schema.org/ItemList",
                                    ],
                                    itemListElement: tocEntries.map((entry) => ({
                                        level: entry.level,
                                        url: '#' + prefix + entry.id,
                                        name: entry.text
                                    }))
                            };

                                // build recursive toc
                                // TODO: deal with incorrect heading levels
                                /*
                                const toc = {
                                    "@type": [
                                        "/schema/TableOfContents",
                                        "https://schema.org/ItemList",
                                    ],
                                    itemListElement: []
                                };

                                for(let i = 0; i < tocEntries.length; i++) {
                                    const entry = tocEntries[i];
                                    const output = {
                                        "@type": "/schema/TableOfContentsElement"  as const,
                                        level: entry.level,
                                        url: '#' + prefix + entry.id,
                                        name: entry.text
                                    };
                                }
                                */

                                JsonLDUtil.setProperty(rs.resource, options.tableOfContents.to, toc);
                            }

                            return JsonLDUtil.setProperty(rs.resource, options.to || options.from, html);
                        });
                    }
                }]
            },
            renderer: {
                partialPaths: ['partials']
            }
        };
    },
};

export interface MarkdownOptions {
    from?: JsonLDUtil.PropertyPath;
    to: JsonLDUtil.PropertyPath;
    markedOptions?: MarkedOptions;
    /** if provided, a Table of Contents object will be generated from headers.
     * the links in the TOC will only work if you are using the https://github.com/markedjs/marked-gfm-heading-id/ extension to add github-slugger ids to the headers. */
    tableOfContents?: {
        /** output property */
        to: JsonLDUtil.PropertyPath;
        /** prefix added to each header's id */
        prefix?: string;
    }
}

export interface TableOfContentsEntry {
    level: number;
    id: string;
    text: string;
}

export interface TableOfContentsElement {
    "@type": "/schema/TableOfContentsElement";
    level: number;
    url: string;
    name: string;
    subheaders?: TableOfContentsElement;
}

export interface MarkdownPluginOptions {
    extensions?: MarkedExtension[];
}

export default markdownPlugin;
