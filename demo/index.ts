const demoPlugin = {
    name: 'freshr-demo',
    version: '0.1.0',
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

export default demoPlugin;
