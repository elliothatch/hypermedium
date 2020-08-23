const demoPlugin = {
    name: 'hypermedium-demo',
    version: '0.1.0',
    pluginApi: '1',
    dependencies: ['core'],
    moduleFactory: (options) => {
        return {
            hypermedia: {
                sitePaths: ['site'],
            },
            renderer: {
                templatePaths: ['templates'],
                partialPaths: ['partials'],
                profileLayouts: {
                    '/schema/welcome-page': 'layouts/welcome-page.hbs',
                    '/schema/post': 'layouts/post.hbs',
                },
            }
        };
    },

};

module.exports = demoPlugin;
