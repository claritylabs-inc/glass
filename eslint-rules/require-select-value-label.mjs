// Base UI's `<Select.Value>` falls back to `String(value)` when it cannot
// resolve a label, so a bare `<SelectValue />` renders the raw option value —
// a Convex id or a snake_case enum — until the popup has been opened. Labels
// are only known ahead of time when `<Select items={...}>` is provided, so
// require either that or explicit `<SelectValue>` children.

function elementName(node) {
  const name = node.name;
  if (name?.type === "JSXIdentifier") return name.name;
  if (name?.type === "JSXMemberExpression" && name.property?.type === "JSXIdentifier") {
    return name.property.name;
  }
  return null;
}

function hasAttribute(node, attribute) {
  return node.attributes.some(
    (candidate) =>
      candidate.type === "JSXSpreadAttribute"
      || (candidate.type === "JSXAttribute" && candidate.name?.name === attribute),
  );
}

function hasChildren(node) {
  const element = node.parent;
  if (element?.type !== "JSXElement") return false;
  return element.children.some(
    (child) =>
      child.type !== "JSXText" || child.value.trim().length > 0,
  );
}

function enclosingSelect(node) {
  let current = node.parent;
  while (current) {
    if (
      current.type === "JSXElement"
      && elementName(current.openingElement) === "Select"
    ) {
      return current.openingElement;
    }
    current = current.parent;
  }
  return null;
}

export const requireSelectValueLabel = {
  meta: {
    type: /** @type {const} */ ("problem"),
    docs: {
      description:
        "Require select triggers to resolve a label instead of rendering the raw value.",
    },
    schema: [],
    messages: {
      rawValue:
        "<SelectValue /> renders the raw option value until the popup opens. Pass `items` to <Select> or give <SelectValue> children.",
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (elementName(node) !== "SelectValue") return;
        if (hasAttribute(node, "render") || hasAttribute(node, "children")) return;
        if (hasChildren(node)) return;
        const select = enclosingSelect(node);
        if (!select || hasAttribute(select, "items")) return;
        context.report({ node, messageId: "rawValue" });
      },
    };
  },
};

const spotSelectPlugin = {
  rules: {
    "require-select-value-label": requireSelectValueLabel,
  },
};

export default spotSelectPlugin;
