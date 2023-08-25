# Hypermedium Plugin: schema-org

This plugin provides handlebars templates for common Schema.org types.

Each schema is impemented as an "includes" partial. This allows them to be easily injected into existing pages and layouts, as cards or list items, for example.

In addition, each type can have its own layout. By default, a layout simply injects the partial of the matching type, but some common and useful types have their own complete layout.

Schema.org has three primary types of classes: "Type", "Property", and "DataType".
To achieve maximum composibility, type templates are composed using templates for their base properties and data types.

Property values might have multiple types. Some properties support an array of values. We make opinionated choices on which properties we choose to support multiple values on.

Subclass templates directly include their supertype template when possible.

All partials accept the same set of parameters:
header level - h1-h6
url?
images/thumbnail?

Templates also make use of inline partials with the `slot-` prefix, which can be used to completely override sections of the template.

Usage:
```
{{#> type/Thing.hbs}}
    {{#*inline "slot-contents"}}
        My content
    {{/inline}}
{{/ type/Thing.hbs}}
```

 - `slot-contents`: Additional contents
