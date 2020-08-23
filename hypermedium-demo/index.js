const demoPlugin = {
	name: 'hypermedium-demo',
	version: '0.1.0',
	pluginApi: '1',
	dependencies: ['core'],
	moduleFactory: (options) => {
		return {
			hypermedia: {
				sitePaths: ['site'],
				processors: [
					{name: 'self'},
					{name: 'tags'},
					{name: 'makeIndex', options: '/schema/post'},
					{name: 'makeIndex', options: '/schema/index/tags'},
					{name: 'curies'},
					{name: 'embed'},
				]
			},
			renderer: {
				templatePaths: ['templates'],
				partialPaths: ['partials'],
				profileLayouts: {
					'/schema/welcome-page': 'layouts/welcome-page.hbs',
				},
			}
		};
	},

};

module.exports = demoPlugin;
