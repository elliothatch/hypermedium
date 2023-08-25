const schemaOrg = {
    name: 'schema-org',
    version: '1.0.0',
    pluginApi: '1',
    dependencies: [],
    moduleFactory: (options) => {
        return {
            renderer: {
                partialPaths: ['partials'],
                profileLayouts: {
                    'https://schema.org/Thing': 'type/Thing.hbs',
                    'https://schema.org/ItemList': 'type/ItemList.hbs',
                }
            }
        };
    },
};

Object.defineProperty(exports, "__esModule", { value: true });
exports.default = schemaOrg;
