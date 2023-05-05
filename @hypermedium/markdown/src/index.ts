import { promisify } from 'util';

import { Plugin, Processor, JsonLDUtil } from 'hypermedium';
import * as Marked from 'marked';

const MarkedAsync = promisify<string, Marked.MarkedOptions | undefined, string>(Marked);

const markdownPlugin: Plugin = {
    name: 'markdown',
    version: '1.0.0',
    pluginApi: '1',
    dependencies: [],
    basePath: '../',
    moduleFactory: (options) => {
        return {
            hypermedia: {
                processorDefinitions: [
                    markdown,
                ]
            }
        };
    },
};

export const markdown: Processor.Definition = {
    name: 'markdown',
    onProcess: (rs, options: MarkdownOptions) => {
        return MarkedAsync(JsonLDUtil.getProperty(rs.resource, options.from), options.markedOptions).then((html) => {
            return JsonLDUtil.setProperty(rs.resource, options.to || options.from, html);
        });
    }
}

export interface MarkdownOptions {
    from?: string;
    to: string;
    markedOptions?: Marked.MarkedOptions;
}

export default markdownPlugin;
