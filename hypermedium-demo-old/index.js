const Path = require('path');

const demoPlugin = {
	name: 'hypermedium-demo-old',
	version: '1.0.0',
	pluginApi: '1',
	dependencies: ['core', 'sass', 'markdown'],
	moduleFactory: (options) => {
		return {
			files: ['dist'],
			hypermedia: {
				sitePaths: ['site'],
				processors: {
					pre: [{
						name: 'self'
					}],
					post: [{
						name: 'matchType',
						options: {
							profile: 'https://schema.org/BlogPosting',
							processors: [{
								name: 'markdown',
								options: {
									from: 'body',
									to: 'bodyHtml',
								}
							}, {
								name: 'excerpt',
								options: {
									from: 'body',
									to: 'excerpt',
									max: 50
								}
							}, {
								name: 'markdown',
								options: {
									from: 'excerpt',
									to: 'excerptHtml',
								}
							}]
						}
					}]
				},
				dynamicResources: [{
					name: 'index',
					options: {
						property: '@type'
					}
				}, {
					name: 'index',
					options: {
						property: 'tag'
					}
				}]
			},
			renderer: {
				templatePaths: ['templates'],
				partialPaths: ['partials'],
				profileLayouts: {
					'/schema/homepage': 'layouts/homepage.hbs',
				},
				context: '/site.json'
			},
			build: {
				buildSteps: {
					sType: 'task',
					definition: 'sass',
					options: {
						// include node_modules so we can @use any installed package (e.g. sanitize.css)
						includePaths: [Path.join(__dirname, 'node_modules')]
					},
					watch: true,
					files: [{
						inputs: {target: ['sass/styles.scss']},
						outputs: {
							css: ['dist/css/styles.css'],
							sourceMap: ['dist/css/styles.css.map'],
						}
					}],
					watchFiles: ['sass']
				}
			}
		};
	},
};

module.exports = demoPlugin;
