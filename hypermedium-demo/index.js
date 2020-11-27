const Path = require('path');

const demoPlugin = {
	name: 'hypermedium-demo',
	version: '0.1.0',
	pluginApi: '1',
	dependencies: ['core', 'sass', 'markdown'],
	moduleFactory: (options) => {
		return {
			hypermedia: {
				sitePaths: ['site'],
				processors: [
					{name: 'self'},
					// process posts
					{name: 'matchProfile', options: {
						profile: '/schema/post',
						processorFactory: 'extend',
						options: {
							obj: {
								author: 'elliot',
								_excerpt: {
									property: 'body',
									"max": 50,
								},
								_markdown: {
									input: 'body',
									output: 'bodyHtml',
								}
							}
						}
					}},
					// configure tags index pages
					{name: 'matchProfile', options: {
						profile: '/schema/index/tags',
						processorFactory: 'extend',
						options: {
							obj: {
								"_embed": {
									"fs:entries": {
										"properties": ["title", "date-created"]
									}
								},
								"_sort": {
									"property": "_embedded.fs:entries",
									"key": "date-created",
									"ascending": false,
									"compare": "date"
								},
							}
						}
					}},
					{name: 'forEach'},
					{name: 'excerpt'},
					{name: 'tags'},
					{name: 'makeIndex', options: '/schema/post'},
					{name: 'makeIndex', options: '/schema/index/tags'},
					{name: 'curies'},
					{name: 'sort'},
					{name: 'embed'},
					// add excerpts to each post in index
					{name: 'matchProfile', options: {
						profile: '/schema/index/schema/post',
						processorFactory: 'forEach',
						options: {
							processorFactory: 'extend',
							property: '_embedded.fs:entries',
							key: '_links.self.href',
							options: {
								obj: {
									_markdown: {
										input: 'excerpt',
										output: 'excerptHtml',
									}
								}
							}
						}
					}},
					{name: 'markdown'},
					//  render markdown on embedded posts
					{name: 'matchProfile', options: {
						profile: '/schema/index/schema/post',
						processorFactory: 'forEach',
						options: {
							processorFactory: 'markdown',
							property: '_embedded.fs:entries',
							key: '_links.self.href',
						}
					}},
					{name: 'sort'}, // final sort for embedded values, etc.
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
					watch: true,
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
