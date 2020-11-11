import { format } from 'prettier';
import { collectCss } from '../helpers/collect-styles';
import { fastClone } from '../helpers/fast-clone';
import { selfClosingTags } from '../parse';
import { JSXLiteComponent } from '../types/jsx-lite-component';
import { JSXLiteNode } from '../types/jsx-lite-node';

/**
 * Test if the binding expression would be likely to generate
 * valid or invalid liquid. If we generate invalid liquid tags
 * Shopify will reject our PUT to update the template
 */
export const isValidLiquidBinding = (str = '') => {
  const strictMatches = Boolean(
    // Test for our `context.shopify.liquid.*(expression), which
    // we regex out later to transform back into valid liquid expressions
    str.match(/(context|ctx)\s*(\.shopify\s*)?\.liquid\s*\./),
  );

  return (
    strictMatches ||
    // Test is the expression is simple and would map to Shopify bindings	    // Test for our `context.shopify.liquid.*(expression), which
    // e.g. `state.product.price` -> `{{product.price}}	    // we regex out later to transform back into valid liquid expressions
    Boolean(str.match(/^[a-z0-9_\.\s]+$/i))
  );
};

type ToLiquidOptions = {
  prettier?: boolean;
};
// TODO: spread support
const blockToLiquid = (json: JSXLiteNode, options: ToLiquidOptions = {}) => {
  if (json.properties._text) {
    return json.properties._text;
  }
  if (json.bindings._text) {
    return `{{${(json.bindings._text as string)
      .replace(/state\./g, '')
      .replace(/props\./g, '')}}}`;
  }

  let str = '';

  if (json.name === 'For') {
    if (
      !(
        isValidLiquidBinding(json.properties._forEach as string) &&
        isValidLiquidBinding(json.properties._forName as string)
      )
    ) {
      return str;
    }
    str += `{% for ${json.properties._forName} in ${json.properties._forEach} %}`;
    if (json.children) {
      str += json.children
        .map((item) => blockToLiquid(item, options))
        .join('\n');
    }

    str += '{% endfor %}';
  } else if (json.name === 'Show') {
    if (!isValidLiquidBinding(json.properties._when as string)) {
      return str;
    }
    str += `{% if ${json.properties._when} %}`;
    if (json.children) {
      str += json.children
        .map((item) => blockToLiquid(item, options))
        .join('\n');
    }

    str += '{% endif %}';
  } else {
    str += `<${json.name} `;

    if (
      json.properties._spread === '_spread' &&
      isValidLiquidBinding(json.properties._spread)
    ) {
      str += `
          {% for _attr in ${json.properties._spread} %}
            {{ _attr[0] }}="{{ _attr[1] }}"
          {% endfor %}
        `;
    }

    for (const key in json.properties) {
      const value = json.properties[key];
      str += ` ${key}="${value}" `;
    }

    for (const key in json.bindings) {
      if (key === '_spread' || key === 'ref' || key === 'css') {
        continue;
      }
      const value = json.bindings[key] as string;
      // TODO: proper babel transform to replace. Util for this
      const useValue = value.replace(/state\./g, '').replace(/props\./g, '');

      if (key.startsWith('on')) {
        // Do nothing
      } else if (isValidLiquidBinding(useValue)) {
        str += ` ${key}="{{${useValue}}}" `;
      }
    }
    if (selfClosingTags.has(json.name)) {
      return str + ' />';
    }
    str += '>';
    if (json.children) {
      str += json.children
        .map((item) => blockToLiquid(item, options))
        .join('\n');
    }

    str += `</${json.name}>`;
  }
  return str;
};

export const componentToLiquid = (
  componentJson: JSXLiteComponent,
  options: ToLiquidOptions = {},
) => {
  const json = fastClone(componentJson);
  let str = json.children.map((item) => blockToLiquid(item)).join('\n');

  const css = collectCss(json);
  if (css.trim().length) {
    str += `<style>${css}</style>`;
  }

  if (options.prettier !== false) {
    str = format(str, {
      parser: 'html',
      plugins: [
        // To support running in browsers
        require('prettier/parser-html'),
        require('prettier/parser-postcss'),
        require('prettier/parser-babel'),
      ],
    });
  }
  return str;
};