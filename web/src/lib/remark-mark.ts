interface MarkdownNode {
  type: string;
  value?: string;
  children?: MarkdownNode[];
}

function visitText(tree: MarkdownNode, visitor: (node: MarkdownNode & { value: string }, index: number, parent: MarkdownNode & { children: MarkdownNode[] }) => void) {
  function walk(node: MarkdownNode) {
    if (!Array.isArray(node.children)) return;
    let i = 0;
    while (i < node.children.length) {
      const child = node.children[i];
      if (child.type === 'text') {
        const before = node.children.length;
        visitor(child as MarkdownNode & { value: string }, i, node as MarkdownNode & { children: MarkdownNode[] });
        const added = node.children.length - before;
        i += 1 + added;
      } else {
        walk(child);
        i++;
      }
    }
  }
  walk(tree);
}

export default function remarkMark() {
  return (tree: MarkdownNode) => {
    visitText(tree, (node, index, parent) => {
      if (!node.value) return;
      const regex = /==(.*?)==/g;
      const matches = [...node.value.matchAll(regex)];
      if (matches.length === 0) return;

      const children: MarkdownNode[] = [];
      let lastIndex = 0;

      for (const match of matches) {
        if (match.index !== undefined && match.index > lastIndex) {
          children.push({
            type: 'text',
            value: node.value.slice(lastIndex, match.index),
          });
        }
        children.push({
          type: 'html',
          value: `<mark>${match[1]}</mark>`,
        });
        if (match.index !== undefined) {
          lastIndex = match.index + match[0].length;
        }
      }

      if (lastIndex < node.value.length) {
        children.push({
          type: 'text',
          value: node.value.slice(lastIndex),
        });
      }

      parent.children.splice(index, 1, ...children);
    });
  };
}
