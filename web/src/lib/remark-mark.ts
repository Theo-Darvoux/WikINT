function visitText(tree: any, visitor: (node: any, index: number, parent: any) => void) {
  function walk(node: any) {
    if (!Array.isArray(node.children)) return;
    let i = 0;
    while (i < node.children.length) {
      const child = node.children[i];
      if (child.type === 'text') {
        const before = node.children.length;
        visitor(child, i, node);
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
  return (tree: any) => {
    visitText(tree, (node: any, index: any, parent: any) => {
      if (!node.value) return;
      const regex = /==(.*?)==/g;
      const matches = [...node.value.matchAll(regex)];
      if (matches.length === 0) return;

      const children = [];
      let lastIndex = 0;

      for (const match of matches) {
        if (match.index > lastIndex) {
          children.push({
            type: 'text',
            value: node.value.slice(lastIndex, match.index),
          });
        }
        children.push({
          type: 'html',
          value: `<mark>${match[1]}</mark>`,
        });
        lastIndex = match.index + match[0].length;
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
