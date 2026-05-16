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
                                let tocElements: TableOfContentsElement[] = [];
                                if(options.tableOfContents.flat) {
                                    tocElements = tocEntries.map((entry) => ({
                                        '@type': 'https://hypermedium.design/schemas/TableOfContentsElement',
                                        level: entry.level,
                                        url: '#' + prefix + entry.id,
                                        name: entry.text
                                    }));
                                }
                                else {
                                    const parents: TableOfContentsElement[] = [];
                                    let lastElement: TableOfContentsElement | undefined = undefined;
                                    for(const entry of tocEntries) {
                                        const element: TableOfContentsElement = {
                                            '@type': 'https://hypermedium.design/schemas/TableOfContentsElement'  as const,
                                            level: entry.level,
                                            url: '#' + prefix + entry.id,
                                            name: entry.text
                                        };

                                        if(!lastElement) {
                                            tocElements.push(element);
                                            lastElement = element;
                                            continue;
                                        }

                                        if(entry.level > lastElement.level) {
                                            if(!lastElement.itemListElement) {
                                                lastElement.itemListElement = [];
                                                lastElement['@type'] = [
                                                    'https://hypermedium.design/schemas/TableOfContentsElement',
                                                    'https://schema.org/ItemList'
                                                ];
                                            }

                                            lastElement.itemListElement.push(element);
                                            parents.push(lastElement);
                                        }
                                        else if(entry.level === lastElement.level) {
                                            if(parents.length === 0) {
                                                tocElements.push(element);
                                            }
                                            else {
                                                const parent = parents[parents.length - 1];
                                                parent.itemListElement!.push(element);
                                            }
                                        }
                                        else {
                                            // entry.level < lastElement.level
                                            while(parents.length > 0 && entry.level <= parents[parents.length - 1].level) {
                                                parents.pop();
                                            }

                                            if(parents.length === 0) {
                                                tocElements.push(element);
                                            }
                                            else
                                                parents[parents.length - 1].itemListElement!.push(element);
                                            }

                                        lastElement = element;
                                    }
                                }

                                const toc: TableOfContents = {
                                    "@type": [
                                        "https://schema.org/schemas/TableOfContents",
                                        "https://schema.org/ItemList",
                                    ],
                                    flat: options.tableOfContents.flat || false,
                                    itemListElement: tocElements
                                };

                                JsonLDUtil.setProperty(rs.resource, options.tableOfContents.to || 'tableOfContents', toc);
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
        /** output property. defaults to 'tableOfContents' */
        to?: JsonLDUtil.PropertyPath;
        /** prefix added to each header's id */
        prefix?: string;
        /** if true, the toc is generated as a flat list.
         * otherwise, the toc is generated with nested structure
         * defaults to false */
        flat?: boolean;
    }
}

export interface TableOfContentsEntry {
    level: number;
    id: string;
    text: string;
}

export interface TableOfContents {
    "@type": [
        "https://schema.org/schemas/TableOfContents",
        "https://schema.org/ItemList",
    ],
    itemListElement: TableOfContentsElement[];
    /** if the ToC is not flat, each TableOfContentsElement may also have @type ItemList.
     * elements that have a larger level are considered "subsections" and are placed inside the "itemListElement" array of their parent section
     */
    flat: boolean;
}

/** if the tableOfContents is not flat  */
export interface TableOfContentsElement {
    '@type': 'https://hypermedium.design/schemas/TableOfContentsElement'
        | ['https://hypermedium.design/schemas/TableOfContentsElement', 'https://schema.org/ItemList'];
    level: number;
    url: string;
    name: string;
    itemListElement?: TableOfContentsElement[];
}

export interface MarkdownPluginOptions {
    extensions?: MarkedExtension[];
}

export default markdownPlugin;
