const TYPOGRAPHY_STYLE_PROPERTIES = new Set([
  "font",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "fontSmoothing",
  "WebkitFontSmoothing",
  "MozOsxFontSmoothing",
  "lineHeight",
  "letterSpacing",
  "textTransform",
  "fontVariant",
  "fontVariantNumeric",
]);

const TYPOGRAPHY_CSS_PROPERTIES = new Set([
  "font",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "font-smoothing",
  "-webkit-font-smoothing",
  "-moz-osx-font-smoothing",
  "line-height",
  "letter-spacing",
  "text-transform",
  "font-variant",
  "font-variant-numeric",
]);

const typographyUtility = /^(?:font-(?:sans|serif|mono|thin|extralight|light|normal|medium|semibold|bold|extrabold|black|\[.+\])|text-(?:xs|sm|base|lg|xl|[2-9]xl|label|tag|\[(?:length:)?(?:[^\]]*(?:px|r?em|vw|vh|ch|ex|cap|lh|%|clamp\(|min\(|max\(|calc\(|var\()[^\]]*)\])|leading-(?:none|tight|snug|normal|relaxed|loose|\d+|\[.+\])|tracking-(?:tighter|tight|normal|wide|wider|widest|\[.+\])|uppercase|lowercase|capitalize|normal-case|italic|not-italic|antialiased|subpixel-antialiased|normal-nums|tabular-nums|lining-nums|oldstyle-nums|proportional-nums|ordinal|slashed-zero|diagonal-fractions|stacked-fractions)$/;

function normalizeUtility(value) {
  const normalized = value.replace(/^!/, "").replace(/!$/, "");
  let bracketDepth = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    if (normalized[index] === "[") bracketDepth += 1;
    else if (normalized[index] === "]") bracketDepth -= 1;
    else if (normalized[index] === "/" && bracketDepth === 0) {
      return normalized.slice(0, index);
    }
  }
  return normalized;
}

function utilityFromToken(token) {
  const normalized = normalizeUtility(token);
  const arbitraryProperty = normalized.match(/(?:^|:)\[(-?[a-z-]+):/);
  if (arbitraryProperty && TYPOGRAPHY_CSS_PROPERTIES.has(arbitraryProperty[1])) {
    return arbitraryProperty[1];
  }
  let bracketDepth = 0;
  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    if (normalized[index] === "]") bracketDepth += 1;
    else if (normalized[index] === "[") bracketDepth -= 1;
    else if (normalized[index] === ":" && bracketDepth === 0) {
      const utility = normalizeUtility(normalized.slice(index + 1));
      return typographyUtility.test(utility) ? utility : null;
    }
  }
  return typographyUtility.test(normalized) ? normalized : null;
}

function reportString(node, value, context) {
  if (
    node.parent?.type === "Property"
    && propertyName(node.parent.key) === "style"
    && isLocalFontDescriptor(node.parent)
  ) {
    return;
  }
  const untyped = value
    .split(/\s+/)
    .map(utilityFromToken)
    .filter(Boolean);
  if (!untyped.length) return;
  context.report({
    node,
    messageId: "utility",
    data: { utilities: [...new Set(untyped)].join(", ") },
  });
}

function isLocalFontDescriptor(node) {
  let current = node;
  while (current) {
    if (
      current.type === "CallExpression"
      && current.callee?.type === "Identifier"
      && current.callee.name === "localFont"
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function propertyName(node) {
  if (!node) return null;
  if (node.type === "Identifier") return node.name;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  return null;
}

export const noUntypedTypography = {
  meta: {
    type: /** @type {const} */ ("problem"),
    docs: {
      description: "Require Spot browser typography to use typed semantic roles.",
    },
    schema: [],
    messages: {
      utility:
        "Untyped typography utilities ({{utilities}}) are prohibited. Use typeStyle(role).",
      inline:
        "Inline typography property '{{property}}' is prohibited. Use a typed typography adapter.",
    },
  },
  create(context) {
    return {
      Literal(node) {
        if (typeof node.value === "string") reportString(node, node.value, context);
      },
      TemplateElement(node) {
        reportString(node, node.value.raw, context);
      },
      Property(node) {
        const name = propertyName(node.key);
        if (name && TYPOGRAPHY_STYLE_PROPERTIES.has(name)) {
          context.report({ node: node.key, messageId: "inline", data: { property: name } });
        }
      },
      MemberExpression(node) {
        const name = node.computed ? propertyName(node.property) : propertyName(node.property);
        if (name && TYPOGRAPHY_STYLE_PROPERTIES.has(name)) {
          context.report({ node: node.property, messageId: "inline", data: { property: name } });
        }
      },
    };
  },
};

const spotTypographyPlugin = {
  rules: {
    "no-untyped-typography": noUntypedTypography,
  },
};

export default spotTypographyPlugin;
