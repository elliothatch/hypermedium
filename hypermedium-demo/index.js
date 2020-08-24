const Path = require('path');

const demoPlugin = {
	name: 'hypermedium-demo',
	version: '0.1.0',
	pluginApi: '1',
	dependencies: ['core', 'sass'],
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
				context: {
					title: 'hypermedium demo',
					navLinks: {
						"author": {
							"href": "/about",
							"title": "About"
						},
						"fs:posts": {
							"href": "/posts",
							"title": "Posts"
						},
						"fs:tags": {
							"href": "/tags",
							"title": "Tags"
						}
					}
				}
			},
			build: {
				buildSteps: {
					sType: 'task',
					definition: 'sass',
					options: {
						// include node_modules so we can @use any installed package (e.g. sanitize.css)
						includePaths: [Path.join(__dirname, 'node_modules')]
					},
					files: [{
						inputs: {target: ['sass/styles.scss']},
						outputs: {
							css: ['dist/css/styles.css'],
							sourceMap: ['dist/css/styles.css.map'],
						}
					}]
				}
			}
		};
	},
};

module.exports = demoPlugin;
