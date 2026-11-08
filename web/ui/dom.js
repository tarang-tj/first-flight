// Tiny DOM helpers. h("button.cls#id", {onclick, "aria-label": "x"}, "text", child)

export function h(spec, attrs, ...kids) {
  const m = /^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i.exec(spec) || [];
  const node = document.createElement(m[1] || "div");
  for (const part of (m[2] || "").match(/[.#][\w-]+/g) || []) {
    if (part[0] === ".") node.classList.add(part.slice(1)); else node.id = part.slice(1);
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  append(node, kids);
  return node;
}

export function append(node, kids) {
  for (const k of kids.flat()) {
    if (k == null || k === false) continue;
    node.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

const SVG_NS = "http://www.w3.org/2000/svg";
export function svg(tag, attrs, ...kids) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null && v !== false) node.setAttribute(k, String(v));
  for (const k of kids.flat()) if (k != null) node.append(k.nodeType ? k : document.createTextNode(String(k)));
  return node;
}
