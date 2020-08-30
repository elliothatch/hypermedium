import { promisify } from 'util';

import { Plugin, Processor, HalUtil } from 'hypermedium';
import * as Marked from 'marked';

const MarkedAsync = promisify<string, Marked.MarkedOptions, string>(Marked);

const markdownPlugin: Plugin = {
    name: 'markdown',
    version: '1.0.0',
    pluginApi: '1',
    dependencies: [],
    basePath: '../',
    moduleFactory: (options) => {
        return {
            hypermedia: {
                processorFactories: {
                    'markdown': markdown,
                }
            }
        };
    },
};

export const markdown: Processor.Factory = (defaultOptions?: MarkdownOptions) => {
    return {
        name: 'markdown',
        fn: (rs) => {
            // TODO: add default options like baseUrl, highlighting, etc
            const _markdown: MarkdownOptions = {
                ...rs.resource._markdown,
                options: {
                    ...defaultOptions,
                    ...(rs.resource._markdown && rs.resource._markdown.options),
                }
            };

            if(!_markdown.input || !_markdown.output) {
                return rs;
            }

            const input = HalUtil.getProperty(rs.resource, _markdown.input);

            if(!input) {
                return rs;
            }

            if(rs.execAsyncResult && rs.execAsyncResult.status === 'resolved') {
                    delete rs.resource._markdown;
                    const resource = {
                        ...rs.resource,
                    };

                    HalUtil.setProperty(resource, _markdown.output, rs.execAsyncResult.result);

                    return {
                        ...rs,
                        resource
                    };
            }
            else if(rs.execAsyncResult && rs.execAsyncResult.status === 'rejected') {
                console.error('compile markdown failed', rs.execAsyncResult.result);
                return rs;
            }
            // if pending, just cancel and reexec

            rs.execAsync(() => MarkedAsync(input, _markdown.options!));
            return rs;
        }
    };
}

export interface MarkdownOptions {
    input?: string;
    output: string;
    options?: Marked.MarkedOptions;
}

export default markdownPlugin;
