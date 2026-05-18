import { type Plugin } from 'hypermedium';

const testSitePlugin: Plugin = {
	name: 'test-site',
	version: '1.0.0',
	pluginApi: '1',
	dependencies: [],
	moduleFactory: (options) => {
		return {
			files: ['dist'],
			hypermedia: {
				sitePaths: ['site'],
			},
			renderer: {
				templatePaths: ['templates'],
				partialPaths: ['partials'],
				profileLayouts: {
				},
				context: '/site.json'
			},
			build: {
			}
		};
	},
};

export default testSitePlugin;
