# freshr
## a blogging platform for all!
a HAL hypermedia engine for dynamic resources with a highly customizable HAL to HTML renderer

# build

```
yarn
```

or

```
npm install
```

# usage

```
yarn start
```

or

```
npm start
```

# road plan
the platform can perform these actions live, through the dashboard:
 - create and edit HAL resources
 - create and edit assets
 - install and remove plugins
 - create live draft versions of the website
 - track and commit changes with git
 - create tasks that can be used as build steps
 - configure dynamic data store

## plugins
the goal: I want to add a forum to my website. Install Plugin "Forum". The plugin is live and can be configured through the dashboard. Customize the HTML template for forum posts, or import a template file and use that instead. The forum posts are stored in the configured data store.

breaking down the structure of this plugin (ignoring user authentication):
 - HAL assets
 	 - resources describing the homepage, thread pages, etc. these resources create the structure of the site's URIs and describe how dynamic data is embedded
 - HTML assets
 	 - handlebars templates and helpers to render those HAL assets (identified by profile)
 	 - scss to be used in the build system, css, javascript, etc.
 - Express middleware
 	 - handles endpoints for creating threads and posts. in this case, creates a corresponding HAL resource. the hypermedia engine detects the change and reprocesses the "thread" resource to include the new post.
 	 - if we were using an external data source, we could implement custom code here to fetch and process the data.
 - webhooks using the Webhook plugin, so other sites can immediately be notified of new posts

each plugin can:
 - extend the hypermedia engine
   - add custom processors
   - add triggers? periodic processors that can update or create resources
 - extend the HTML engine
   - add handlebars helpers
 - extend the build engine
	 - add tasks that can be used as build steps
 	 - add task blueprints that depend on external libraries (e.g. compile sass)
 - add endpoints in express
 - create new data store types?
 - include assets
 	 - static assets that can be used in the build engine, e.g. templates, images
 	 - HAL resources
 - access and extend configurations of other plugins
