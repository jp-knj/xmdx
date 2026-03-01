/**
 * Rehype plugin that normalizes GFM task list items.
 * @module vite-plugin/rehype-tasklist
 */

type HastNode = {
  type: string;
  [key: string]: unknown;
};

type HastElement = HastNode & {
  type: 'element';
  tagName: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

type HastText = HastNode & {
  type: 'text';
  value?: string;
};

function isElement(node: HastNode | undefined): node is HastElement {
  return node?.type === 'element' && typeof node.tagName === 'string';
}

function isText(node: HastNode | undefined): node is HastText {
  return node?.type === 'text';
}

function hasTaskListClass(node: HastNode): boolean {
  if (!isElement(node) || node.tagName !== 'li') return false;
  const className = node.properties?.className;
  if (Array.isArray(className)) {
    return className.some((c) => typeof c === 'string' && c === 'task-list-item');
  }
  return typeof className === 'string' && className.split(/\s+/).includes('task-list-item');
}

function isCheckboxInput(node: HastNode): boolean {
  if (!isElement(node) || node.tagName !== 'input') return false;
  const props = node.properties ?? {};
  const inputType = props.type;
  return inputType === 'checkbox';
}

function isWhitespaceText(node: HastNode): boolean {
  return isText(node) && (node.value ?? '').trim().length === 0;
}

const BLOCK_TAG_NAMES = new Set([
  'ul', 'ol', 'div', 'blockquote', 'pre', 'table', 'hr', 'dl', 'details', 'section',
]);

function isBlockElement(node: HastNode): boolean {
  return isElement(node) && BLOCK_TAG_NAMES.has(node.tagName);
}

function wrapTaskItemChildren(children: HastNode[]): HastNode[] {
  const firstMeaningfulIndex = children.findIndex((child) => !isWhitespaceText(child));
  if (firstMeaningfulIndex === -1) return children;

  const firstMeaningful = children[firstMeaningfulIndex];
  if (!firstMeaningful) return children;
  if (!isCheckboxInput(firstMeaningful)) return children;

  const prefix = children.slice(0, firstMeaningfulIndex);
  const tail = children.slice(firstMeaningfulIndex + 1);

  // Split tail at the first block element: inline content goes inside
  // <label><span>, block children become siblings after </label>.
  const firstBlockIndex = tail.findIndex((child) => isBlockElement(child));
  const inlineChildren = firstBlockIndex === -1 ? tail : tail.slice(0, firstBlockIndex);
  const blockChildren = firstBlockIndex === -1 ? [] : tail.slice(firstBlockIndex);

  const span: HastElement = {
    type: 'element',
    tagName: 'span',
    properties: {},
    children: inlineChildren,
  };
  const label: HastElement = {
    type: 'element',
    tagName: 'label',
    properties: {},
    children: [firstMeaningful, span],
  };
  return [...prefix, label, ...blockChildren];
}

/**
 * Rehype plugin that normalizes GFM task list items to:
 * <li class="task-list-item"><label><input ... /><span>Text</span></label></li>
 * including loose-list (<p>) variants.
 */
export function rehypeTasklistEnhancer() {
  return (tree: HastNode) => {
    const visit = (node: HastNode): void => {
      if (hasTaskListClass(node) && Array.isArray(node.children)) {
        const children = node.children as HastNode[];
        const firstMeaningfulIndex = children.findIndex((child) => !isWhitespaceText(child));
        const firstMeaningful = firstMeaningfulIndex >= 0 ? children[firstMeaningfulIndex] : undefined;

        if (isElement(firstMeaningful) && firstMeaningful.tagName === 'p' && Array.isArray(firstMeaningful.children)) {
          firstMeaningful.children = wrapTaskItemChildren(firstMeaningful.children as HastNode[]);
        } else {
          node.children = wrapTaskItemChildren(children);
        }
      }

      const children = Array.isArray(node.children) ? (node.children as HastNode[]) : null;
      if (children) {
        for (const child of children) visit(child);
      }
    };

    visit(tree);
  };
}
